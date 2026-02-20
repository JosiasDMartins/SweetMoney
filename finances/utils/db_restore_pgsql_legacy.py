"""
Restore Legacy PostgreSQL Backups using Django ORM

This module handles restoring old PostgreSQL backups created with pg_dump
by parsing the COPY format and using Django ORM for safe, transactional import.
"""

import logging
import tempfile
import re
import subprocess
from pathlib import Path
from datetime import datetime
from django.conf import settings
from django.utils.translation import gettext as _
from django.db import transaction, connection
import gc
import time

logger = logging.getLogger(__name__)


def restore_postgres_sql_backup(uploaded_file):
    """
    Restore a legacy PostgreSQL backup file (.sql format with COPY statements).

    This function supports two restore methods:
    1. Direct SQL execution (via psql) - for empty databases
       - Executes the complete .sql file (schema + data)
       - Used when the database has no tables yet

    2. Django ORM-based restore - for existing databases
       - Parses COPY data and imports via ORM
       - Deletes existing family data (only that family, not entire DB)
       - Imports data transactionally using Django ORM
       - Handles special characters and encoding properly

    Args:
        uploaded_file: Django UploadedFile object containing the backup (.sql)

    Returns:
        dict: {
            'success': bool,
            'family': dict (if success),
            'users': list (if success),
            'error': str (if failure),
            'details': str (if failure)
        }
    """
    temp_backup_path = None

    try:
        # Check if database is empty (no tables yet)
        from django.db import connection
        table_exists = False
        try:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_schema = 'public'
                        AND table_name = 'finances_family'
                    );
                """)
                table_exists = cursor.fetchone()[0]
        except Exception as e:
            logger.warning(f"[LEGACY_RESTORE] Could not check if table exists: {e}")

        # If tables don't exist, use direct SQL restore
        if not table_exists:
            logger.info(f"[LEGACY_RESTORE] Database is empty, using direct SQL restore")
            return _restore_sql_direct(uploaded_file)

        # Otherwise use ORM-based restore
        logger.info(f"[LEGACY_RESTORE] Tables exist, using ORM-based restore")
        logger.info(f"[LEGACY_RESTORE] Inside try block, importing models...")
        from django.contrib.auth import get_user_model
        from finances.models import (
            Family, FamilyMember, FamilyConfiguration, Period, FlowGroup,
            Transaction, BankBalance, Notification
        )

        UserModel = get_user_model()

        logger.info(f"[LEGACY_RESTORE] ========== STARTING ORM-BASED RESTORE ==========")
        logger.info(f"[LEGACY_RESTORE] Uploaded file: {uploaded_file.name} ({uploaded_file.size} bytes)")

        # STEP 1: Validate and save uploaded file
        if not uploaded_file:
            return {
                'success': False,
                'error': _('No backup file provided')
            }

        if not uploaded_file.name.endswith('.sql'):
            return {
                'success': False,
                'error': _('Invalid file format. Expected .sql file.')
            }

        timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_backup_path = Path(tempfile.gettempdir()) / f"restore_backup_{timestamp_str}.sql"

        logger.info(f"[LEGACY_RESTORE] Saving uploaded file to: {temp_backup_path}")
        with open(temp_backup_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)

        logger.info(f"[LEGACY_RESTORE] File saved ({temp_backup_path.stat().st_size} bytes)")

        # STEP 2: Parse SQL file and extract COPY data
        logger.info(f"[LEGACY_RESTORE] Parsing SQL file...")
        try:
            backup_data = _parse_sql_backup(temp_backup_path)
        except Exception as e:
            logger.error(f"[LEGACY_RESTORE] Failed to parse SQL file: {e}")
            import traceback
            logger.error(f"[LEGACY_RESTORE] Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'error': _('Failed to parse backup file'),
                'details': str(e)
            }

        logger.info(f"[LEGACY_RESTORE] Parsed {len(backup_data)} tables from backup")
        logger.info(f"[LEGACY_RESTORE] Table names: {list(backup_data.keys())}")
        print(f"[DEBUG] Parsed {len(backup_data)} tables: {list(backup_data.keys())}")

        # STEP 3: Check if family already exists
        logger.info(f"[LEGACY_RESTORE] Checking for existing families...")
        print(f"[DEBUG] Checking for existing families...")
        existing_family = None
        try:
            existing_families = Family.objects.all()
            if existing_families.exists():
                existing_family = existing_families.first()
                logger.info(f"[LEGACY_RESTORE] Found existing family: {existing_family.name} (ID: {existing_family.id})")
            else:
                logger.info(f"[LEGACY_RESTORE] No existing families found")
        except Exception as e:
            logger.warning(f"[LEGACY_RESTORE] Could not check existing family: {e}")

        # STEP 4: Verify backup is for same family (if one exists)
        logger.info(f"[LEGACY_RESTORE] Verifying backup family data...")
        backup_family_data = backup_data.get('finances_family', [])
        if not backup_family_data:
            return {
                'success': False,
                'error': _('Backup file contains no family data')
            }

        backup_family_id = backup_family_data[0].get('id')
        backup_family_name = backup_family_data[0].get('name')

        logger.info(f"[LEGACY_RESTORE] Backup family: {backup_family_name} (ID: {backup_family_id})")

        # Check if families are different by comparing NAME (not ID)
        # IDs can change between installations, but the family name identifies the family
        if existing_family and existing_family.name.strip().lower() != backup_family_name.strip().lower():
            return {
                'success': False,
                'error': _('Cannot restore backup from different family. '
                          'Current database has family "%(current)s", but backup is from "%(backup)s". '
                          'To restore this backup, you need to: '
                          '1) Log in with an admin account from the "%(backup)s" family, or '
                          '2) Start with a fresh database, or '
                          '3) Create a new family account for "%(backup)s" before restoring.') % {
                              'current': existing_family.name,
                              'backup': backup_family_name
                          }
            }

        # If families match by name, log the restore and continue
        if existing_family:
            logger.info(f"[LEGACY_RESTORE] Same family detected (name: {existing_family.name}), allowing restore")
            if existing_family.id != backup_family_id:
                logger.info(f"[LEGACY_RESTORE] Note: Family ID differs (DB: {existing_family.id}, Backup: {backup_family_id}), will overwrite")

        # STEP 5: Import data transactionally using Django ORM
        logger.info(f"[LEGACY_RESTORE] Starting transactional import...")

        try:
            logger.info(f"[LEGACY_RESTORE] Entering transaction.atomic() block...")
            with transaction.atomic():
                logger.info(f"[LEGACY_RESTORE] Inside atomic block, calling _import_data_orm...")
                # Delete existing family data if present
                if existing_family:
                    logger.info(f"[LEGACY_RESTORE] Deleting existing family data...")
                    existing_family.delete()
                    logger.info(f"[LEGACY_RESTORE] Existing family deleted")

                # Import data in correct order (respecting foreign keys)
                _import_data_orm(backup_data)

            logger.info(f"[LEGACY_RESTORE] Transactional import completed successfully")

        except Exception as e:
            logger.error(f"[LEGACY_RESTORE] Transactional import failed: {e}")
            import traceback
            logger.error(f"[LEGACY_RESTORE] Traceback: {traceback.format_exc()}")
            return {
                'success': False,
                'error': _('Failed to import backup data'),
                'details': str(e)
            }

        # STEP 6: Verify imported data
        logger.info(f"[LEGACY_RESTORE] Verifying imported data...")

        try:
            families = Family.objects.all()
            if not families.exists():
                return {
                    'success': False,
                    'error': _('Import completed but no family data found')
                }

            imported_family = families.first()
            user_count = UserModel.objects.count()

            logger.info(f"[LEGACY_RESTORE] Import verification:")
            logger.info(f"[LEGACY_RESTORE]   Family: {imported_family.name}")
            logger.info(f"[LEGACY_RESTORE]   Users: {user_count}")

            if user_count == 0:
                logger.warning(f"[LEGACY_RESTORE] WARNING: No users imported!")

            # Get user info for response
            users_info = []
            members = FamilyMember.objects.filter(family=imported_family)
            for member in members:
                try:
                    user = member.user
                    users_info.append({
                        'username': user.username,
                        'email': user.email or '',
                        'role': member.role
                    })
                except Exception:
                    pass

            # Create reload flag
            try:
                from finances.views.views_updater import create_reload_flag
                create_reload_flag()
                logger.info(f"[LEGACY_RESTORE] Reload flag created")
            except Exception:
                pass

            logger.info(f"[LEGACY_RESTORE] ========== RESTORE COMPLETED SUCCESSFULLY ==========")

            return {
                'success': True,
                'family': {
                    'name': imported_family.name,
                    'id': imported_family.id
                },
                'users': users_info,
                'message': _('Database restored successfully')
            }

        except Exception as e:
            logger.error(f"[LEGACY_RESTORE] Verification failed: {e}", exc_info=True)
            return {
                'success': False,
                'error': _('Verification failed'),
                'details': str(e)
            }

    except Exception as e:
        logger.error(f"[LEGACY_RESTORE] Unexpected error: {e}", exc_info=True)
        logger.error(f"[LEGACY_RESTORE] Error type: {type(e).__name__}")
        import traceback
        logger.error(f"[LEGACY_RESTORE] Full traceback: {traceback.format_exc()}")
        return {
            'success': False,
            'error': _('Restore failed'),
            'details': str(e)
        }

    finally:
        # Clean up temporary file
        if temp_backup_path and temp_backup_path.exists():
            try:
                temp_backup_path.unlink()
                logger.info(f"[LEGACY_RESTORE] Temporary file deleted")
            except Exception as e:
                logger.warning(f"[LEGACY_RESTORE] Could not delete temp file: {e}")


def _restore_sql_direct(uploaded_file):
    """
    Restore PostgreSQL backup by executing SQL directly via psql.

    This method is used when the database is empty (no tables exist yet).

    Process:
    1. Run Django migrations to create current database schema
    2. Filter backup to exclude django_migrations table
    3. Execute psql to restore data (schema already exists, only INSERT/COPY data)
    4. Run migrations again to apply any remaining schema updates

    This approach ensures:
    - Database has the correct current schema structure
    - Old backup data is imported into correct structure
    - Schema is properly updated after import

    Args:
        uploaded_file: Django UploadedFile object containing the backup (.sql)

    Returns:
        dict: {
            'success': bool,
            'family': dict (if success),
            'users': list (if success),
            'error': str (if failure),
            'details': str (if failure)
        }
    """
    import os
    from django.contrib.auth import get_user_model
    from finances.models import Family, FamilyMember

    temp_backup_path = None
    UserModel = get_user_model()

    try:
        logger.info(f"[DIRECT_SQL] ========== STARTING DIRECT SQL RESTORE ==========")
        logger.info(f"[DIRECT_SQL] Uploaded file: {uploaded_file.name} ({uploaded_file.size} bytes)")

        # Validate file
        if not uploaded_file or not uploaded_file.name.endswith('.sql'):
            return {
                'success': False,
                'error': _('Invalid file format. Expected .sql file.')
            }

        # STEP 1: Run migrations FIRST to create correct database structure
        logger.info(f"[DIRECT_SQL] Step 1: Running migrations to create database schema...")
        try:
            from django.core.management import call_command
            call_command('migrate', verbosity=0, interactive=False)
            logger.info(f"[DIRECT_SQL] Initial migrations completed successfully")
        except Exception as e:
            logger.error(f"[DIRECT_SQL] Initial migrations failed: {e}")
            return {
                'success': False,
                'error': _('Failed to create database schema'),
                'details': str(e)
            }

        # STEP 2: Save uploaded file to temp and filter out django_migrations
        timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_backup_path = Path(tempfile.gettempdir()) / f"restore_direct_{timestamp_str}.sql"
        temp_filtered_path = Path(tempfile.gettempdir()) / f"restore_direct_filtered_{timestamp_str}.sql"

        logger.info(f"[DIRECT_SQL] Saving uploaded file to: {temp_backup_path}")
        with open(temp_backup_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)

        logger.info(f"[DIRECT_SQL] File saved ({temp_backup_path.stat().st_size} bytes)")

        # Filter out django_migrations table from backup
        logger.info(f"[DIRECT_SQL] Step 2: Filtering out django_migrations from backup...")
        with open(temp_backup_path, 'r', encoding='utf-8') as infile:
            with open(temp_filtered_path, 'w', encoding='utf-8') as outfile:
                skip_section = False
                for line in infile:
                    # Skip django_migrations table definition and data
                    if 'django_migrations' in line and ('CREATE TABLE' in line or 'COPY django_migrations' in line or 'ALTER TABLE django_migrations' in line):
                        skip_section = True
                        continue

                    # Stop skipping at next CREATE TABLE or COPY statement
                    if skip_section and (line.startswith('CREATE TABLE') or line.startswith('COPY ')):
                        skip_section = False

                    # Write line if not in skip section
                    if not skip_section:
                        outfile.write(line)

        logger.info(f"[DIRECT_SQL] Filtered backup created")

        # Get database connection parameters
        db_config = settings.DATABASES['default']
        db_name = db_config['NAME']
        db_user = db_config['USER']
        db_password = db_config['PASSWORD']
        db_host = db_config['HOST'] or 'localhost'
        db_port = db_config['PORT'] or '5432'

        logger.info(f"[DIRECT_SQL] Database: {db_name} at {db_host}:{db_port}")

        # Set PGPASSWORD environment variable for psql
        env = os.environ.copy()
        env['PGPASSWORD'] = db_password

        # Execute psql command with FILTERED backup (without django_migrations)
        logger.info(f"[DIRECT_SQL] Step 3: Executing psql to restore database data...")
        cmd = [
            'psql',
            '-h', db_host,
            '-p', str(db_port),
            '-U', db_user,
            '-d', db_name,
            '-f', str(temp_filtered_path)
        ]

        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout
        )

        if result.returncode != 0:
            logger.error(f"[DIRECT_SQL] psql failed with return code {result.returncode}")
            logger.error(f"[DIRECT_SQL] STDERR: {result.stderr}")
            return {
                'success': False,
                'error': _('Failed to restore database using psql'),
                'details': result.stderr[-1000:] if result.stderr else 'Unknown error'
            }

        logger.info(f"[DIRECT_SQL] Data restored successfully")

        # STEP 4: Run migrations AFTER restore to update schema if needed
        logger.info(f"[DIRECT_SQL] Step 4: Running migrations after restore to update schema...")
        try:
            from django.core.management import call_command
            call_command('migrate', verbosity=0, interactive=False)
            logger.info(f"[DIRECT_SQL] Post-restore migrations completed successfully")
        except Exception as e:
            logger.warning(f"[DIRECT_SQL] Post-restore migrations had issues (non-critical): {e}")
            # Continue anyway - data should be usable

        # Verify imported data
        logger.info(f"[DIRECT_SQL] Verifying imported data...")

        try:
            families = Family.objects.all()
            if not families.exists():
                return {
                    'success': False,
                    'error': _('Restore completed but no family data found')
                }

            imported_family = families.first()
            user_count = UserModel.objects.count()

            logger.info(f"[DIRECT_SQL] Import verification:")
            logger.info(f"[DIRECT_SQL]   Family: {imported_family.name}")
            logger.info(f"[DIRECT_SQL]   Users: {user_count}")

            if user_count == 0:
                logger.warning(f"[DIRECT_SQL] WARNING: No users imported!")

            # Get user info for response
            users_info = []
            members = FamilyMember.objects.filter(family=imported_family)
            for member in members:
                try:
                    user = member.user
                    users_info.append({
                        'username': user.username,
                        'email': user.email or '',
                        'role': member.role
                    })
                except Exception:
                    pass

            # Create reload flag
            try:
                from finances.views.views_updater import create_reload_flag
                create_reload_flag()
                logger.info(f"[DIRECT_SQL] Reload flag created")
            except Exception:
                pass

            # Apply any pending updates automatically
            logger.info(f"[DIRECT_SQL] Applying pending updates to ensure database is current...")
            try:
                from finances.views.views_updater import apply_updates_programmatically
                update_success = apply_updates_programmatically()
                if update_success:
                    logger.info(f"[DIRECT_SQL] Updates applied successfully")
                else:
                    logger.warning(f"[DIRECT_SQL] Some updates failed, but restore should be functional")
            except Exception as e:
                logger.warning(f"[DIRECT_SQL] Could not apply automatic updates (non-critical): {e}")

            logger.info(f"[DIRECT_SQL] ========== DIRECT SQL RESTORE COMPLETED SUCCESSFULLY ==========")

            return {
                'success': True,
                'family': {
                    'name': imported_family.name,
                    'id': imported_family.id
                },
                'users': users_info,
                'message': _('Database restored successfully')
            }

        except Exception as e:
            logger.error(f"[DIRECT_SQL] Verification failed: {e}", exc_info=True)
            return {
                'success': False,
                'error': _('Verification failed'),
                'details': str(e)
            }

    except subprocess.TimeoutExpired:
        logger.error(f"[DIRECT_SQL] psql command timed out after 5 minutes")
        return {
            'success': False,
            'error': _('Database restore timed out. The backup file might be too large.')
        }
    except Exception as e:
        logger.error(f"[DIRECT_SQL] Unexpected error: {e}", exc_info=True)
        return {
            'success': False,
            'error': _('Restore failed'),
            'details': str(e)
        }
    finally:
        # Clean up temporary files
        for temp_file in [temp_backup_path, temp_filtered_path]:
            if temp_file and temp_file.exists():
                try:
                    temp_file.unlink()
                    logger.info(f"[DIRECT_SQL] Temporary file deleted: {temp_file.name}")
                except Exception as e:
                    logger.warning(f"[DIRECT_SQL] Could not delete temp file {temp_file.name}: {e}")


def _parse_sql_backup(sql_file_path):
    """
    Parse a PostgreSQL dump file and extract COPY data into dictionaries.

    This parser:
    - Skips schema/SET statements
    - Extracts COPY blocks with column definitions and data rows
    - Converts tab-separated COPY format to Python dicts
    - Handles NULL values (\\N), booleans (t/f), and special characters

    Args:
        sql_file_path: Path to the .sql backup file

    Returns:
        dict: {table_name: [list of row dicts]}
    """
    logger.info(f"[PARSE_SQL] Parsing {sql_file_path}")

    backup_data = {}

    with open(sql_file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split into sections by COPY statements
    # Pattern: COPY tablename (columns) FROM stdin;
    # Followed by tab-separated data
    # Ending with \.

    lines = content.split('\n')

    i = 0
    while i < len(lines):
        line = lines[i]

        # Find COPY statements
        if line.startswith('COPY ') and ' FROM stdin;' in line:
            # Parse COPY statement
            # Format: COPY tablename ("col1", "col2") FROM stdin;
            match = re.match(r'COPY (\w+)\s+\((.+?)\) FROM stdin;', line)
            if not match:
                logger.warning(f"[PARSE_SQL] Could not parse COPY line: {line[:100]}")
                i += 1
                continue

            table_name = match.group(1)
            columns_str = match.group(2)

            # Parse column names (remove quotes)
            columns = [col.strip().strip('"') for col in columns_str.split(',')]

            logger.debug(f"[PARSE_SQL] Found table: {table_name} with {len(columns)} columns")

            # Extract data rows
            data_rows = []
            i += 1  # Move to first data row

            while i < len(lines):
                row_line = lines[i]

                # End of COPY block
                if row_line.strip() == '\\.':
                    i += 1
                    break

                # Skip empty lines
                if not row_line.strip():
                    i += 1
                    continue

                # Parse tab-separated row
                # NULL is \N, strings can contain tabs
                values = _parse_copy_row(row_line, len(columns))

                if len(values) == len(columns):
                    row_dict = dict(zip(columns, values))
                    data_rows.append(row_dict)
                else:
                    logger.warning(f"[PARSE_SQL] Row column count mismatch: expected {len(columns)}, got {len(values)}")

                i += 1

            # Store parsed data
            # Add 'finances_' prefix if not already present (avoid double prefix)
            if not table_name.startswith('finances_'):
                dict_key = f'finances_{table_name}'
            else:
                dict_key = table_name

            if data_rows:
                backup_data[dict_key] = data_rows
                logger.info(f"[PARSE_SQL] Parsed {len(data_rows)} rows from {table_name}")

        else:
            i += 1

    logger.info(f"[PARSE_SQL] Parsed {len(backup_data)} tables total")
    return backup_data


def _parse_copy_row(row_line, expected_columns):
    """
    Parse a single COPY row (tab-separated) into values.

    Handles:
    - Tab separation
    - NULL values (\\N)
    - Boolean values (t/f)
    - Empty strings

    Args:
        row_line: String containing the row data
        expected_columns: Number of expected columns

    Returns:
        list: Parsed values
    """
    # Split by tab, but handle empty strings
    values = []
    current_value = []
    in_value = False

    for char in row_line + '\t':  # Add trailing tab to flush last value
        if char == '\t':
            # End of field
            value_str = ''.join(current_value).strip()

            # Convert NULL
            if value_str == '\\N':
                values.append(None)
            # Convert boolean
            elif value_str == 't':
                values.append(True)
            elif value_str == 'f':
                values.append(False)
            # Empty string
            elif value_str == '':
                values.append('')
            # Regular string
            else:
                values.append(value_str)

            current_value = []
            in_value = False
        else:
            current_value.append(char)
            in_value = True

    return values


def _import_data_orm(backup_data):
    """
    Import parsed backup data using Django ORM.

    Imports in correct order to respect foreign key constraints.
    Uses bulk_create for efficiency.

    Args:
        backup_data: Dict from _parse_sql_backup

    Raises:
        Exception: If import fails
    """
    from finances.models import (
        CustomUser, Family, FamilyMember, FamilyConfiguration,
        Period, FlowGroup, Transaction, BankBalance
    )

    logger.info(f"[IMPORT_ORM] Starting ORM import...")
    logger.info(f"[IMPORT_ORM] Available tables: {list(backup_data.keys())}")

    # Import order respecting FK constraints:
    # 1. Family
    # 2. Users
    # 3. FamilyMember (links User + Family)
    # 4. FamilyConfiguration
    # 5. Period
    # 6. FlowGroup
    # 7. FlowGroupAssignedMembers/Children
    # 8. Transaction
    # 9. BankBalance

    # 1. Import Family
    if 'finances_family' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing Family...")
        try:
            family_data = backup_data['finances_family'][0]  # Only one family
            logger.info(f"[IMPORT_ORM] Family data keys: {family_data.keys()}, values: {family_data}")
            family = Family(**family_data)
            family.save(force_insert=True)  # Force INSERT to allow explicit ID
            logger.info(f"[IMPORT_ORM] Family created: {family_data.get('name')}")
        except Exception as e:
            logger.error(f"[IMPORT_ORM] Failed to import Family: {e}", exc_info=True)
            raise

    # 2. Import Users (handle existing users by updating them)
    if 'finances_customuser' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing {len(backup_data['finances_customuser'])} users...")
        for user_data in backup_data['finances_customuser']:
            username = user_data.get('username')
            user_id = user_data.get('id')

            if not username:
                logger.warning(f"[IMPORT_ORM] Skipping user without username: {user_data}")
                continue

            # Add default values for fields that might be missing in old backups
            if 'email_notifications_enabled' not in user_data:
                user_data['email_notifications_enabled'] = False
            if 'email_notify_overdue' not in user_data:
                user_data['email_notify_overdue'] = False
            if 'email_notify_overbudget' not in user_data:
                user_data['email_notify_overbudget'] = False
            if 'email_notify_new_transaction' not in user_data:
                user_data['email_notify_new_transaction'] = False

            # Check if user already exists by ID or username
            try:
                existing_user = CustomUser.objects.get(id=user_id)
                # User exists - update their data
                for field, value in user_data.items():
                    if field != 'id':  # Don't update the ID
                        setattr(existing_user, field, value)
                existing_user.save(update_fields=[f for f in user_data.keys() if f != 'id'])
                logger.debug(f"[IMPORT_ORM] Updated existing user: {username}")
            except CustomUser.DoesNotExist:
                try:
                    # Check by username
                    existing_user = CustomUser.objects.get(username=username)
                    # User with this username exists (different ID) - update it
                    for field, value in user_data.items():
                        if field != 'id':  # Don't update the ID
                            setattr(existing_user, field, value)
                    existing_user.save(update_fields=[f for f in user_data.keys() if f != 'id'])
                    logger.debug(f"[IMPORT_ORM] Updated existing user by username: {username}")
                except CustomUser.DoesNotExist:
                    # User doesn't exist - create new one
                    password = user_data.pop('password', None)
                    # Create user instance
                    user = CustomUser(**user_data)

                    # Check if password is already a hash (from backup)
                    # Django password hashes start with algorithm name like pbkdf2_sha256$, bcrypt$, etc.
                    if password and password.startswith(('pbkdf2_sha256$', 'bcrypt$', 'argon2$', 'sha256$')):
                        # Already a hashed password, save directly
                        user.password = password
                        logger.debug(f"[IMPORT_ORM] Using hashed password for new user: {username}")
                    else:
                        # Plain text password, hash it properly
                        user.set_password(password)
                        logger.debug(f"[IMPORT_ORM] Hashing password for new user: {username}")

                    # Save with force_insert to allow explicit ID
                    user.save(force_insert=True)
                    logger.debug(f"[IMPORT_ORM] Created new user: {username}")

        logger.info(f"[IMPORT_ORM] Users imported successfully")

    # 3. Import FamilyMember
    if 'finances_familymember' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing FamilyMember...")
        try:
            # Can't use bulk_create with force_insert, so create one by one
            for data in backup_data['finances_familymember']:
                member = FamilyMember(**data)
                member.save(force_insert=True)
            logger.info(f"[IMPORT_ORM] FamilyMember imported")
        except Exception as e:
            logger.error(f"[IMPORT_ORM] Failed to import FamilyMember: {e}", exc_info=True)
            raise

    # 4. Import FamilyConfiguration
    if 'finances_familyconfiguration' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing FamilyConfiguration...")
        FamilyConfiguration.objects.bulk_create([
            FamilyConfiguration(**data) for data in backup_data['finances_familyconfiguration']
        ])
        logger.info(f"[IMPORT_ORM] FamilyConfiguration imported")

    # 5. Import Period
    if 'finances_period' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing {len(backup_data['finances_period'])} periods...")
        Period.objects.bulk_create([
            Period(**data) for data in backup_data['finances_period']
        ])
        logger.info(f"[IMPORT_ORM] Periods imported")

    # 6. Import FlowGroup
    if 'finances_flowgroup' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing {len(backup_data['finances_flowgroup'])} flow groups...")
        FlowGroup.objects.bulk_create([
            FlowGroup(**data) for data in backup_data['finances_flowgroup']
        ])
        logger.info(f"[IMPORT_ORM] FlowGroups imported")

    # 7. Import FlowGroup assignments
    if 'finances_flowgroup_assigned_members' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing FlowGroupAssignedMembers...")
        # Note: This model may not exist in all versions, skip if fails
        try:
            from finances.models import FlowGroupAssignedMembers
            FlowGroupAssignedMembers.objects.bulk_create([
                FlowGroupAssignedMembers(**data) for data in backup_data['finances_flowgroup_assigned_members']
            ])
            logger.info(f"[IMPORT_ORM] FlowGroupAssignedMembers imported")
        except ImportError:
            logger.warning(f"[IMPORT_ORM] FlowGroupAssignedMembers model not found, skipping")

    if 'finances_flowgroup_assigned_children' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing FlowGroupAssignedChildren...")
        try:
            from finances.models import FlowGroupAssignedChildren
            FlowGroupAssignedChildren.objects.bulk_create([
                FlowGroupAssignedChildren(**data) for data in backup_data['finances_flowgroup_assigned_children']
            ])
            logger.info(f"[IMPORT_ORM] FlowGroupAssignedChildren imported")
        except ImportError:
            logger.warning(f"[IMPORT_ORM] FlowGroupAssignedChildren model not found, skipping")

    # 8. Import Transactions
    if 'finances_transaction' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing {len(backup_data['finances_transaction'])} transactions...")
        Transaction.objects.bulk_create([
            Transaction(**data) for data in backup_data['finances_transaction']
        ])
        logger.info(f"[IMPORT_ORM] Transactions imported")

    # 9. Import BankBalance
    if 'finances_bankbalance' in backup_data:
        logger.info(f"[IMPORT_ORM] Importing BankBalance...")
        BankBalance.objects.bulk_create([
            BankBalance(**data) for data in backup_data['finances_bankbalance']
        ])
        logger.info(f"[IMPORT_ORM] BankBalance imported")

    logger.info(f"[IMPORT_ORM] All data imported successfully")
