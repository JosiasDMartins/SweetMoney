"""
Database-agnostic JSON backup and restore utilities.

This module handles:
1. JSON export of family data (schema-safe)
2. JSON import/restore with dependency sorting (to fix FK violations)
3. Works with both PostgreSQL and SQLite
"""

import logging
import json
import tempfile
from pathlib import Path
from datetime import datetime
from io import StringIO

from django.conf import settings
from django.core import serializers
from django.core.management import call_command
from django.db import connection, transaction, models
from django.db.models import Q
from django.utils.translation import gettext as _
from django.contrib.auth import get_user_model

# Import models
from finances.models import (
    Family, FamilyMember, FamilyConfiguration, Period, 
    FlowGroup, Transaction, Investment, BankBalance, 
    Notification, FlowGroupAccess, FamilyMemberRoleHistory,
    SystemVersion
)

logger = logging.getLogger(__name__)

# ============================================================
# Helpers
# ============================================================

def get_existing_field_names(model):
    """
    Returns a list of field names for the model that actually exist as columns in the database.
    This handles the case where the code has been updated (new fields added) but 
    migrations haven't run yet (e.g. creating backup before update).
    """
    table_name = model._meta.db_table
    with connection.cursor() as cursor:
        # Get list of actual columns in the database table
        try:
            # This is cross-db compatible (works for PG and SQLite in Django)
            existing_columns = {col.name for col in connection.introspection.get_table_description(cursor, table_name)}
        except Exception:
            # Fallback if table doesn't exist or other error
            return []
            
    fields_to_serialize = []
    for field in model._meta.get_fields():
        # We only care about concrete fields that are serialized
        if field.concrete and not field.many_to_many:
             if field.column in existing_columns:
                 fields_to_serialize.append(field.name)

    # Also include ManyToManyFields (assigned_members, assigned_children) for backup
    # ManyToManyFields don't have columns in table, but should be serialized
    for field in model._meta.get_fields():
        if field.many_to_many:
            fields_to_serialize.append(field.name)

    return fields_to_serialize

def serialize_safely(queryset, model):
    """
    Helper to serialize a queryset with only existing fields.
    This prevents "column does not exist" errors when backup runs before migrations.

    Also handles ManyToManyFields (assigned_members, assigned_children) correctly.
    """
    if not queryset.exists():
        return []

    # Check if model has ManyToManyFields that need special handling
    has_many_to_many = any(
        field.many_to_many and field.concrete
        for field in model._meta.get_fields()
        )

    existing_fields = get_existing_field_names(model)
    if not existing_fields:
            logger.warning(f"[JSON_UTILS] No existing fields found for model {model.__name__}")
            return []

    # IMPORTANT: When model has ManyToManyFields, DO NOT pass fields parameter
    # This allows Django to automatically serialize all fields including ManyToMany
    if has_many_to_many:
        data = serializers.serialize(
            'json',
            queryset,
            indent=2,
            use_natural_foreign_keys=True,
            use_natural_primary_keys=True
            # DO NOT pass fields= parameter - let Django decide what to serialize
        )
    else:
        # For models without ManyToManyFields, restrict to existing fields (schema-safe)
        data = serializers.serialize(
            'json',
            queryset,
            indent=2,
            use_natural_foreign_keys=True,
            use_natural_primary_keys=True,
            fields=existing_fields
        )
    return json.loads(data)

# ============================================================
# Export Functions
# ============================================================

def create_family_json_backup(family_id):
    """
    Create a family-isolated JSON backup using direct serialization.
    
    This works for both PostgreSQL and SQLite.

    Args:
        family_id (int): ID of the family to backup

    Returns:
        dict: Result with paths and metadata
    """
    try:
        User = get_user_model()

        # Get family object
        try:
            family = Family.objects.get(id=family_id)
            family_name = family.name
        except Family.DoesNotExist:
            return {
                'success': False,
                'error': _('Family with ID %(family_id)s not found') % {'family_id': family_id}
            }

        # Create backups directory
        base_dir = Path(settings.BASE_DIR)
        backups_dir = base_dir / 'db' / 'backups'
        backups_dir.mkdir(parents=True, exist_ok=True)

        # Generate backup filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_family_name = "".join(c for c in family_name if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_family_name = safe_family_name.replace(' ', '_')
        backup_filename = f'backup_{safe_family_name}_{timestamp}.json'
        backup_path = backups_dir / backup_filename

        logger.info(f"[JSON_BACKUP] Creating JSON backup for '{family_name}' (ID: {family_id})")
        
        # STEP 1: Collect and Serialize objects
        all_serialized_objects = []

        # 1. System Version (if exists)
        all_serialized_objects.extend(serialize_safely(SystemVersion.objects.all(), SystemVersion))

        # 2. Family
        all_serialized_objects.extend(serialize_safely(Family.objects.filter(id=family_id), Family))

        # 3. Family Configuration
        if hasattr(family, 'configuration'):
            all_serialized_objects.extend(serialize_safely(FamilyConfiguration.objects.filter(family=family), FamilyConfiguration))

        # 4. Users (associated with members)
        members_qs = FamilyMember.objects.filter(family=family)
        user_ids = list(members_qs.values_list('user_id', flat=True))
        if user_ids:
            users_qs = User.objects.filter(id__in=user_ids)
            all_serialized_objects.extend(serialize_safely(users_qs, User))

        # 5. Family Members
        all_serialized_objects.extend(serialize_safely(members_qs, FamilyMember))
        
        # 6. Role History
        role_history_qs = FamilyMemberRoleHistory.objects.filter(member__family=family)
        all_serialized_objects.extend(serialize_safely(role_history_qs, FamilyMemberRoleHistory))

        # 7. Periods
        period_qs = Period.objects.filter(family=family)
        all_serialized_objects.extend(serialize_safely(period_qs, Period))

        # 8. FlowGroups
        flowgroup_qs = FlowGroup.objects.filter(family=family)
        all_serialized_objects.extend(serialize_safely(flowgroup_qs, FlowGroup))
        
        # 9. FlowGroupAccess
        access_qs = FlowGroupAccess.objects.filter(
            Q(member__family=family) | Q(flow_group__family=family)
        ).distinct()
        all_serialized_objects.extend(serialize_safely(access_qs, FlowGroupAccess))

        # 10. Transactions
        transaction_qs = Transaction.objects.filter(flow_group__family=family)
        all_serialized_objects.extend(serialize_safely(transaction_qs, Transaction))

        # 11. Investments
        investment_qs = Investment.objects.filter(family=family)
        all_serialized_objects.extend(serialize_safely(investment_qs, Investment))

        # 12. Bank Balances
        balance_qs = BankBalance.objects.filter(family=family)
        all_serialized_objects.extend(serialize_safely(balance_qs, BankBalance))

        # 13. Notifications
        notification_qs = Notification.objects.filter(family=family)
        all_serialized_objects.extend(serialize_safely(notification_qs, Notification))
        
        logger.info(f"[JSON_BACKUP] Total objects serialized: {len(all_serialized_objects)}")

        # STEP 2: Write backup file
        backup_data = {
            'version': '2.0',
            'family': {
                'id': family_id,
                'name': family_name
            },
            'generated': datetime.now().isoformat(),
            'users_count': len(user_ids),
            'objects': all_serialized_objects
        }

        with open(backup_path, 'w', encoding='utf-8') as f:
            json.dump(backup_data, f, indent=2, ensure_ascii=False)

        file_size = backup_path.stat().st_size
        logger.info(f"[JSON_BACKUP] Backup created successfully: {backup_path}")

        return {
            'success': True,
            'backup_path': str(backup_path),
            'filename': backup_filename,
            'size': file_size,
            'family_name': family_name,
            'family_id': family_id,
            'users_count': len(user_ids),
            'rows_copied': len(all_serialized_objects)
        }

    except Exception as e:
        logger.error(f"[JSON_BACKUP] Backup failed: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e)
        }

# ============================================================
# Restore Functions
# ============================================================

def restore_json_backup(uploaded_file):
    """
    Restore a database from an uploaded JSON backup file.
    Valid for both PostgreSQL and SQLite.

    Features:
    - Sorts objects by dependency order to prevent FK violations.
    - Handles 'User' vs 'FamilyMember' order.
    - Clears existing family data before restore.
    """
    temp_backup_path = None

    try:
        User = get_user_model()
        
        logger.info(f"[JSON_RESTORE] ========== STARTING JSON RESTORE ==========")

        # STEP 1: Validate uploaded file
        if not uploaded_file:
            return {'success': False, 'error': _('No backup file provided')}

        # STEP 2: Save uploaded file to temporary location
        timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_backup_path = Path(tempfile.gettempdir()) / f"restore_backup_{timestamp_str}.json"

        with open(temp_backup_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)

        # STEP 3: Read and validate backup JSON
        try:
            with open(temp_backup_path, 'r', encoding='utf-8') as f:
                backup_data = json.load(f)

            if 'version' not in backup_data or 'objects' not in backup_data:
                return {'success': False, 'error': _('Invalid backup file format')}
            
            # Identify target family from backup metadata
            family_meta = backup_data.get('family', {})
            family_name = family_meta.get('name', 'Unknown')
            
            logger.info(f"[JSON_RESTORE] Backup family: {family_name}")

        except json.JSONDecodeError as e:
            return {'success': False, 'error': _('Invalid JSON file'), 'details': str(e)}

        # STEP 4: Smart Sort - Reorder objects to satisfy foreign keys
        # The priority list defines which models should be loaded FIRST
        model_priority = [
            'finances.systemversion',
            'finances.family',
            'finances.familyconfiguration',
            'auth.user',             # Standard Django user
            'finances.customuser',   # Custom user model
            'finances.familymember', # Depends on User and Family
            'finances.familymemberrolehistory',
            'finances.period',
            'finances.flowgroup',       # Load FlowGroups FIRST ( FlowGroupAccess depends on it)
            'finances.flowgroupaccess', # Load FlowGroupAccess AFTER FlowGroup
            'finances.transaction',
            'finances.investment',
            'finances.bankbalance',
            'finances.notification'
        ]

        def get_priority(obj):
            model_name = obj.get('model', '').lower()
            try:
                return model_priority.index(model_name)
            except ValueError:
                return 999  # Low priority for unknown models

        raw_objects = backup_data['objects']
        sorted_objects = sorted(raw_objects, key=get_priority)
        
        logger.info(f"[JSON_RESTORE] Objects reordered for dependency safety")

        # STEP 5: Check existing data and clear it
        # We need to clear data for the family being restored to avoid conflicts
        # Strategy: Data is cleared transactionally if possible
        
        with transaction.atomic():
            # Check for existing family with same name/ID? 
            # In single-family deployments, we often just want to replace the main family.
            # But here we are cautious.
            
            # Deleting existing family data
            # Note: We assume the user wants to OVERWRITE the family data if it exists.
            # Ideally we would match by ID, but IDs might change or conflict. 
            # For restore, we usually clear everything if it's a "full restore" scenario, 
            # but this is "family isolated".
            
            # Since we don't know the exact ID mapping strategy (loaddata keeps IDs),
            # we must ensure the ID is free or we are updating it.
            # Loaddata tries to UPDATE if ID exists, or CREATE if not.
            
            # ISSUE: If we have existing data with FKs, update might fail or retain dirty state.
            # SAFER STRATEGY: Delete the family entirely before invalidating FKs.
            
            # Find family ID and name from the objects list to be sure
            target_family_id = None
            target_family_name = None
            for obj in sorted_objects:
                if obj['model'] == 'finances.family':
                    target_family_id = obj['pk']
                    target_family_name = obj['fields'].get('name', 'Unknown')
                    break

            # Check if there's any existing family in the database
            all_existing_families = Family.objects.all()
            if all_existing_families.exists():
                existing_family = all_existing_families.first()

                # Validate: Check if backup family is different from existing family (by NAME, not ID)
                # IDs can change, but the family name identifies the family
                if existing_family and target_family_name:
                    existing_name_normalized = existing_family.name.strip().lower()
                    backup_name_normalized = target_family_name.strip().lower()

                    if existing_name_normalized != backup_name_normalized:
                        # Different families - block the restore
                        logger.error(f"[JSON_RESTORE] Family mismatch: DB has '{existing_family.name}', backup has '{target_family_name}'")
                        return {
                            'success': False,
                            'error': _('Cannot restore backup from different family. '
                                      'Current database has family "%(current)s", but backup is from "%(backup)s". '
                                      'To restore this backup, you need to: '
                                      '1) Log in with an admin account from the "%(backup)s" family, or '
                                      '2) Start with a fresh database, or '
                                      '3) Create a new family account for "%(backup)s" before restoring.') % {
                                          'current': existing_family.name,
                                          'backup': target_family_name
                                      }
                        }

                    # Same family - log and continue
                    logger.info(f"[JSON_RESTORE] Same family detected (name: {existing_family.name}), allowing restore")
                    if existing_family.id != target_family_id:
                        logger.info(f"[JSON_RESTORE] Note: Family ID differs (DB: {existing_family.id}, Backup: {target_family_id}), will overwrite")

                # Delete existing family before restore.
                # Use the family we already found by name (existing_family), not the backup's ID.
                # The backup may have a different ID than the DB, so deleting by backup ID
                # would miss the existing family and cause duplicates.
                if existing_family:
                    logger.info(f"[JSON_RESTORE] Deleting existing family '{existing_family.name}' (ID: {existing_family.id}) before restore")
                    existing_family.delete()
            else:
                logger.info(f"[JSON_RESTORE] No existing families found, fresh restore")
            
            # Also cleanup Users if they are part of the backup and conflict?
            # Users are unique by username.
            # If we restore a User that exists, loaddata will overwrite it. 
            # That is usually desired for a restore.

            # STEP 6: Save sorted data to a new temporary file for loaddata
            loaddata_path = temp_backup_path.parent / f"sorted_loaddata_{timestamp_str}.json"
            with open(loaddata_path, 'w', encoding='utf-8') as f:
                json.dump(sorted_objects, f, indent=2, ensure_ascii=False)

            # STEP 7: Run loaddata
            logger.info(f"[JSON_RESTORE] Running loaddata...")
            out = StringIO()
            call_command('loaddata', str(loaddata_path), stdout=out)
            
            # If we are here, loaddata succeeded (otherwise it raises exception)
            logger.info(f"[JSON_RESTORE] Loaddata success")

            # STEP 8: Post-restore cleanup (Sequences)
            # Reset PostgreSQL sequences to avoid duplicate key errors on next insert
            from finances.utils.db_sequence_utils import reset_postgres_sequences
            logger.info(f"[JSON_RESTORE] Resetting PostgreSQL sequences...")
            seq_result = reset_postgres_sequences('finances')
            if not seq_result['success']:
                logger.warning(f"[JSON_RESTORE] Sequence reset failed: {seq_result.get('error')}")
            else:
                logger.info(f"[JSON_RESTORE] Reset {seq_result.get('sequences_reset', 0)} sequences")

        # Verification (outside atomic block)
        # Use name-based lookup since IDs may differ between backup and DB
        verified_family = Family.objects.filter(name=target_family_name).first()
        if verified_family:
            user_count = FamilyMember.objects.filter(family=verified_family).count()
            return {
                'success': True,
                'family': {'name': verified_family.name, 'id': verified_family.id},
                'users': [], # Can populate if needed
                'message': _('Restore successful')
            }
        else:
             return {'success': False, 'error': _('Restored family not found')}

    except Exception as e:
        logger.error(f"[JSON_RESTORE] Error: {e}", exc_info=True)
        return {'success': False, 'error': str(e), 'details': str(e)}
    finally:
        # Cleanup
        if temp_backup_path and temp_backup_path.exists():
            try:
                temp_backup_path.unlink()
            except: pass
