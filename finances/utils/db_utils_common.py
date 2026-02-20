"""
Common database utilities used across multiple modules.

This module provides functions that are used by both SQLite and PostgreSQL
specific modules, such as database engine detection and backup type detection.
"""

import sqlite3
import logging
from pathlib import Path
from django.conf import settings

logger = logging.getLogger(__name__)


def get_database_engine():
    """
    Get the current database engine type.

    Returns:
        str: 'sqlite' or 'postgresql' or 'unknown'
    """
    engine = settings.DATABASES['default']['ENGINE']

    if 'sqlite3' in engine:
        return 'sqlite'
    elif 'postgresql' in engine:
        return 'postgresql'
    else:
        return 'unknown'


def detect_backup_type_by_filename(filename):
    """
    Detect backup type based solely on filename extension.

    This is used when we only have the filename (not a full path),
    such as with Django UploadedFile objects.

    Args:
        filename: str - Just the filename (e.g., "backup.sql")

    Returns:
        str: 'sqlite', 'postgresql', or 'unknown'
    """
    if not filename:
        return 'unknown'

    filename = str(filename).lower()

    if filename.endswith('.sqlite3') or filename.endswith('.db') or filename.endswith('.sqlite'):
        return 'sqlite'
    elif filename.endswith('.json'):
        return 'json'
    elif filename.endswith('.sql'):
        return 'postgresql'
    else:
        return 'unknown'


def detect_backup_type(file_path):
    """
    Detect whether a backup file is SQLite or PostgreSQL.

    Detection strategy:
    1. Check file extension first (.sqlite3, .json, .sql)
    2. Try to open as SQLite database - if successful, it's SQLite
    3. If SQLite fails, check file signature for PostgreSQL dump
    4. PostgreSQL custom format dumps start with 'PGDMP'
    5. Django dumpdata format is valid JSON - check for SweetMoney format

    Args:
        file_path: Path or str to the backup file

    Returns:
        str: 'sqlite', 'postgresql', or 'unknown'
    """
    try:
        file_path = Path(file_path)

        if not file_path.exists():
            logger.error(f"[DETECT_TYPE] File does not exist: {file_path}")
            return 'unknown'

        # STRATEGY 0: Check file extension (fastest)
        suffix = file_path.suffix.lower()
        if suffix == '.sqlite3' or suffix == '.db' or suffix == '.sqlite':
            logger.info(f"[DETECT_TYPE] File extension indicates SQLite: {file_path}")
            # Verify it's actually a valid SQLite file
            try:
                conn = sqlite3.connect(str(file_path))
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
                cursor.fetchone()
                cursor.close()
                conn.close()
                logger.info(f"[DETECT_TYPE] File is SQLite database")
                return 'sqlite'
            except sqlite3.DatabaseError:
                pass
        elif suffix == '.json':
            logger.info(f"[DETECT_TYPE] File extension indicates PostgreSQL (Django dumpdata): {file_path}")
            # Verify it's valid JSON with SweetMoney structure
            try:
                import json
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # Check if it has SweetMoney backup structure
                if isinstance(data, dict) and 'version' in data and 'objects' in data:
                    logger.info(f"[DETECT_TYPE] File is SweetMoney JSON backup (version {data.get('version')})")
                    return 'json'
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                logger.debug(f"[DETECT_TYPE] Not valid SweetMoney JSON: {e}")
            return 'json'
        elif suffix == '.sql':
            logger.info(f"[DETECT_TYPE] File extension indicates PostgreSQL (pg_dump): {file_path}")
            return 'postgresql'

        # STRATEGY 1: Try to open as SQLite database
        try:
            logger.info(f"[DETECT_TYPE] Attempting to open as SQLite: {file_path}")
            conn = sqlite3.connect(str(file_path))
            cursor = conn.cursor()

            # Try to query sqlite_master (exists in all SQLite databases)
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
            cursor.fetchone()

            cursor.close()
            conn.close()

            logger.info(f"[DETECT_TYPE] File is SQLite database")
            return 'sqlite'

        except sqlite3.DatabaseError as e:
            logger.debug(f"[DETECT_TYPE] Not a SQLite database: {e}")
            # Not SQLite, continue to check PostgreSQL

        # STRATEGY 1.5: Check for JSON content (even without .json extension)
        try:
            import json
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            # Check if it has SweetMoney backup structure
            if isinstance(data, dict) and 'version' in data and 'objects' in data:
                logger.info(f"[DETECT_TYPE] File is SweetMoney JSON backup (no extension, detected by content)")
                return 'json'
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

        # STRATEGY 2: Check for PostgreSQL custom dump signature
        # PostgreSQL custom format dumps start with "PGDMP" magic bytes
        try:
            with open(file_path, 'rb') as f:
                # Read first 5 bytes
                header = f.read(5)

                # PostgreSQL custom format signature
                if header == b'PGDMP':
                    logger.info(f"[DETECT_TYPE] File is PostgreSQL custom dump (PGDMP signature)")
                    return 'postgresql'

                # Check for plain SQL dump (starts with -- or /*)
                if header.startswith(b'--') or header.startswith(b'/*'):
                    logger.info(f"[DETECT_TYPE] File appears to be PostgreSQL plain SQL dump")
                    return 'postgresql'

        except Exception as e:
            logger.error(f"[DETECT_TYPE] Error reading file header: {e}")

        logger.warning(f"[DETECT_TYPE] Could not determine backup type")
        return 'unknown'

    except Exception as e:
        logger.error(f"[DETECT_TYPE] Error detecting backup type: {e}", exc_info=True)
        return 'unknown'
