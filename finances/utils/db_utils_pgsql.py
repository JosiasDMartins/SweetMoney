"""
PostgreSQL-specific database utilities.

This module provides all PostgreSQL-specific operations including:
- Backup creation using pg_dump
- Database restore using psql (for family-isolated .sql backups)
- PostgreSQL database configuration and verification
"""

import os
import logging
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime
from django.conf import settings
from django.utils.translation import gettext as _
from django.db import connections
import psycopg2
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
import gc
import time

logger = logging.getLogger(__name__)


# ============================================================
# PostgreSQL Configuration and Verification Functions
# ============================================================

def postgres_is_configured():
    """
    Check if PostgreSQL is configured as the primary database.

    Returns:
        bool: True if PostgreSQL is configured with all required credentials, False otherwise
    """
    db_engine = settings.DATABASES['default']['ENGINE']
    if 'postgresql' not in db_engine:
        return False

    # Check if all required PostgreSQL credentials are present
    db_config = settings.DATABASES['default']
    required_fields = ['NAME', 'USER', 'PASSWORD', 'HOST']

    for field in required_fields:
        value = db_config.get(field)
        if not value or value == 'unknown':
            logger.warning(f"[PGSQL_UTILS] PostgreSQL configured but {field} is missing or invalid")
            return False

    return True


def postgres_has_data():
    """
    Check if PostgreSQL database already has data (users).

    Returns:
        bool: True if database has users, False otherwise
    """
    try:
        from django.contrib.auth import get_user_model
        UserModel = get_user_model()

        # Try to count users
        user_count = UserModel.objects.count()
        return user_count > 0

    except Exception as e:
        # Table might not exist yet
        logger.debug(f"[PGSQL_UTILS] Could not check PostgreSQL data: {e}")
        return False


def check_postgres_database_exists():
    """
    Check if the PostgreSQL database exists.
    If not, create it.

    Returns:
        dict: {'exists': bool, 'created': bool, 'message': str}
    """
    db_config = settings.DATABASES['default']
    db_name = db_config['NAME']
    db_user = db_config['USER']
    db_password = db_config['PASSWORD']
    db_host = db_config['HOST']
    db_port = db_config.get('PORT', '5432')

    try:
        # Connect to 'postgres' database to check if target database exists
        logger.info(f"[PGSQL_UTILS] Checking if database '{db_name}' exists...")

        conn = psycopg2.connect(
            dbname='postgres',
            user=db_user,
            password=db_password,
            host=db_host,
            port=db_port
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()

        # Check if database exists
        cursor.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (db_name,)
        )
        exists = cursor.fetchone() is not None

        if exists:
            logger.info(f"[PGSQL_UTILS] [OK] Database '{db_name}' exists")
            cursor.close()
            conn.close()
            return {
                'exists': True,
                'created': False,
                'message': f"Database '{db_name}' already exists"
            }

        # Database doesn't exist - create it
        logger.info(f"[PGSQL_UTILS] [WARN] Database '{db_name}' does not exist - creating...")

        cursor.execute(sql.SQL("CREATE DATABASE {}").format(
            sql.Identifier(db_name)
        ))

        logger.info(f"[PGSQL_UTILS] [OK] Database '{db_name}' created successfully")

        cursor.close()
        conn.close()

        return {
            'exists': True,
            'created': True,
            'message': f"Database '{db_name}' created successfully"
        }

    except psycopg2.OperationalError as e:
        logger.error(f"[PGSQL_UTILS] [ERROR] Cannot connect to PostgreSQL server: {e}")
        return {
            'exists': False,
            'created': False,
            'message': f"Cannot connect to PostgreSQL: {e}"
        }
    except Exception as e:
        logger.error(f"[PGSQL_UTILS] [ERROR] Error checking/creating database: {e}")
        return {
            'exists': False,
            'created': False,
            'message': f"Error: {e}"
        }


# ============================================================
# PostgreSQL Backup Functions
# ============================================================

def create_postgres_backup(family_id=None):
    """
    Create a backup of PostgreSQL database.
    
    NOTE: Family-isolated backups are now handled by db_utils_json.py.
    This function now only handles FULL database backups via pg_dump.

    Args:
        family_id (int, optional): Ignored/Deprecated.

    Returns:
        dict: {'success': bool, 'backup_path': str, 'filename': str, 'size': int, 'error': str}
    """
    if family_id is not None:
        logger.warning("[PGSQL_BACKUP] Family-isolated backup requested via create_postgres_backup. This is deprecated. Use create_family_json_backup instead.")
        # For backward compatibility, we could call the new function, but circular imports might be an issue.
        # Since db_backup.py handles routing, we assume this is only called for full backups.
    
    return _create_full_postgres_backup()


def _create_full_postgres_backup():
    """
    Create a FULL backup of PostgreSQL database using pg_dump.
    This backs up the entire database with all families.

    Returns:
        dict: {'success': bool, 'backup_path': str, 'filename': str, 'error': str}
    """
    try:
        db_config = settings.DATABASES['default']

        # Get database connection parameters
        db_name = db_config.get('NAME')
        db_user = db_config.get('USER')
        db_password = db_config.get('PASSWORD')
        db_host = db_config.get('HOST', 'localhost')
        db_port = db_config.get('PORT', '5432')

        # Create backups directory
        base_dir = Path(settings.BASE_DIR)
        backups_dir = base_dir / 'db' / 'backups'
        backups_dir.mkdir(parents=True, exist_ok=True)

        # Generate backup filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_filename = f'backup_full_{timestamp}.dump'
        backup_path = backups_dir / backup_filename

        logger.info(f"[PGSQL_BACKUP] Creating FULL PostgreSQL backup: {backup_path}")

        # Build pg_dump command
        # Using custom format (-Fc) which is compressed and suitable for pg_restore
        cmd = [
            'pg_dump',
            '--username', db_user,
            '--host', db_host,
            '--port', str(db_port),
            '--dbname', db_name,
            '--format', 'c',  # Custom format (compressed)
            '--file', str(backup_path)
        ]

        # Set PGPASSWORD environment variable for authentication
        env = os.environ.copy()
        env['PGPASSWORD'] = db_password

        # Execute pg_dump
        logger.info(f"[PGSQL_BACKUP] Executing pg_dump command")
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout
        )

        if result.returncode != 0:
            logger.error(f"[PGSQL_BACKUP] pg_dump failed: {result.stderr}")
            return {
                'success': False,
                'error': _('PostgreSQL backup failed: %(error)s') % {'error': result.stderr}
            }

        # Verify backup file was created
        if not backup_path.exists():
            return {
                'success': False,
                'error': _('Backup file was not created')
            }

        file_size = backup_path.stat().st_size
        logger.info(f"[PGSQL_BACKUP] FULL PostgreSQL backup created successfully ({file_size} bytes)")

        return {
            'success': True,
            'backup_path': str(backup_path),
            'filename': backup_filename,
            'size': file_size
        }

    except subprocess.TimeoutExpired:
        logger.error(f"[PGSQL_BACKUP] PostgreSQL backup timed out")
        return {
            'success': False,
            'error': _('Backup operation timed out')
        }
    except FileNotFoundError:
        logger.error(f"[PGSQL_BACKUP] pg_dump command not found")
        return {
            'success': False,
            'error': _('pg_dump command not found. Please ensure PostgreSQL client tools are installed.')
        }
    except Exception as e:
        logger.error(f"[PGSQL_BACKUP] PostgreSQL backup failed: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e)
        }


# Legacy functions moved to db_utils_json.py check git history if needed
