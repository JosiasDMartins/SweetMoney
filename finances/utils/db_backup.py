"""
Database backup and restore utility with support for multiple database backends.

This module provides a unified interface (facade) for creating and restoring database backups
that works with both SQLite and PostgreSQL by delegating to specialized modules.
"""

import logging
from django.utils.translation import gettext as _

# Import from new organized modules
from finances.utils.db_utils_common import get_database_engine, detect_backup_type, detect_backup_type_by_filename
from finances.utils.db_utils_sqlite import create_sqlite_backup
from finances.utils.db_utils_pgsql import create_postgres_backup
from finances.utils.db_utils_json import create_family_json_backup, restore_json_backup
from finances.utils.db_restore_pgsql_legacy import restore_postgres_sql_backup
from finances.utils.db_restore_migration import restore_sqlite_backup_to_postgres

logger = logging.getLogger(__name__)


def create_database_backup(family_id=None):
    """
    Create a database backup file.

    Automatically detects the database backend and delegates to the appropriate
    backup function.

    Args:
        family_id (int, optional): ID of the family to backup. If None, backs up entire database.
                                   If provided, creates a family-isolated backup with only that family's data.

    Returns:
        dict: {
            'success': bool,
            'backup_path': str (if success),
            'filename': str (if success),
            'size': int (if success),
            'family_name': str (if family_id provided and success),
            'family_id': int (if family_id provided and success),
            'users_count': int (if family_id provided and success),
            'rows_copied': int (if family_id provided and success),
            'error': str (if not success)
        }
    """
    engine = get_database_engine()

    if family_id is not None:
        logger.info(f"[DB_BACKUP] Creating FAMILY-ISOLATED backup for family ID {family_id} on {engine} database")
    else:
        logger.info(f"[DB_BACKUP] Creating FULL backup for {engine} database")

    if family_id is not None:
        logger.info(f"[DB_BACKUP] Creating FAMILY-ISOLATED backup for family ID {family_id} (Format: JSON)")
        return create_family_json_backup(family_id)

    if engine == 'sqlite':
        return create_sqlite_backup(family_id=None) # Full backup only
    elif engine == 'postgresql':
        return create_postgres_backup(family_id=None) # Full backup only
    else:
        return {
            'success': False,
            'error': _('Unsupported database engine: %(engine)s') % {'engine': engine}
        }


def restore_database_backup(uploaded_file):
    """
    Restore a database from an uploaded backup file.

    This function automatically detects:
    1. The backup file type (SQLite .sqlite3, PostgreSQL .json, or PostgreSQL .sql)
    2. The current database engine
    3. Delegates to the appropriate restore function

    Backup format compatibility:
    - SQLite .sqlite3 → PostgreSQL (migration)
    - PostgreSQL .json (new, schema-agnostic)
    - PostgreSQL .sql (legacy, pg_dump format)

    Args:
        uploaded_file: Django UploadedFile object containing the backup

    Returns:
        dict: {
            'success': bool,
            'family': dict (if success),
            'users': list (if success),
            'message': str (if success),
            'error': str (if failure),
            'details': str (if failure)
        }
    """
    logger.info(f"[DB_RESTORE] ========== STARTING DATABASE RESTORE ==========")
    logger.info(f"[DB_RESTORE] Uploaded file: {uploaded_file.name} ({uploaded_file.size} bytes)")

    # Save to temp file first to enable content-based detection
    import tempfile
    from pathlib import Path

    # Preserve original extension for content detection
    original_ext = Path(uploaded_file.name).suffix if Path(uploaded_file.name).suffix else '.backup'
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=original_ext)
    temp_path = Path(temp_file.name)
    temp_file.close()

    # Write uploaded content to temp file
    with open(temp_path, 'wb') as f:
        for chunk in uploaded_file.chunks():
            f.write(chunk)

    logger.info(f"[DB_RESTORE] Saved to temp file: {temp_path}")

    # Detect backup type by content (more reliable than filename)
    backup_type = detect_backup_type(temp_path)
    logger.info(f"[DB_RESTORE] Detected backup type: {backup_type}")

    # Get current database engine
    engine = get_database_engine()
    logger.info(f"[DB_RESTORE] Current database engine: {engine}")

    # Create new UploadedFile-like object with temp path
    from django.core.files.uploadedfile import SimpleUploadedFile
    from io import BytesIO

    # Read temp file content
    with open(temp_path, 'rb') as f:
        file_content = f.read()

    # Create new file-like object with original filename (for routing)
    restored_file = SimpleUploadedFile(
        uploaded_file.name,
        file_content,
        content_type='application/octet-stream'
    )

    # Route to appropriate restore function
    try:
        if backup_type == 'json':
            logger.info(f"[DB_RESTORE] Route: JSON Backup (Database Agnostic)")
            return restore_json_backup(restored_file)

        elif backup_type == 'sqlite' and engine == 'postgresql':
            # SQLite backup being restored to PostgreSQL (migration)
            logger.info(f"[DB_RESTORE] Route: SQLite → PostgreSQL migration")
            result = restore_sqlite_backup_to_postgres(restored_file)
            return result

        elif backup_type == 'sqlite' and engine == 'sqlite':
            # SQLite backup being restored to SQLite (same engine)
            logger.info(f"[DB_RESTORE] Route: SQLite → SQLite (not implemented yet)")
            return {
                'success': False,
                'error': _('Restoring SQLite backups to SQLite database is not yet supported. Please use the .db file directly.')
            }

        elif backup_type == 'postgresql':
            # PostgreSQL custom/sql backup
            if uploaded_file.name.endswith('.sql'):
                # Legacy pg_dump format
                logger.info(f"[DB_RESTORE] Route: PostgreSQL .sql (legacy format)")
                result = restore_postgres_sql_backup(restored_file)
                return result
            
            else:
                 # Fallback/Unknown
                return {
                    'success': False,
                    'error': _('Unsupported PostgreSQL backup format. Please use .json or .sql')
                }

        else:
            return {
                'success': False,
                'error': _('Unsupported backup type: %(type)s') % {'type': backup_type}
            }
    finally:
        # Clean up temp file
        try:
            if temp_path.exists():
                temp_path.unlink()
                logger.info(f"[DB_RESTORE] Cleaned up temp file: {temp_path}")
        except Exception as e:
            logger.warning(f"[DB_RESTORE] Could not delete temp file {temp_path}: {e}")
