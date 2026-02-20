"""
Convert Legacy PostgreSQL Backups to Django Format

This module converts old .sql backups (pg_dump format) to new .json format
(Django dumpdata format) for better compatibility across SweetMoney versions.
"""

import logging
import json
import tempfile
from pathlib import Path
from datetime import datetime
from django.conf import settings
from django.utils.translation import gettext as _

logger = logging.getLogger(__name__)


def convert_sql_to_json(sql_file_path, output_path=None):
    """
    Convert a legacy .sql backup to Django .json format.

    This reads the SQL file, extracts data using Django ORM,
    and saves it as a JSON backup in the new format.

    Args:
        sql_file_path: Path to the .sql backup file
        output_path: Optional path for output .json file

    Returns:
        dict: {
            'success': bool,
            'json_path': str (if success),
            'error': str (if failure)
        }
    """
    try:
        from django.core.management import call_command
        from io import StringIO
        import psycopg2
        from psycopg2 import sql
        import os

        db_config = settings.DATABASES['default']
        db_name = db_config.get('NAME')
        db_user = db_config.get('USER')
        db_password = db_config.get('PASSWORD')
        db_host = db_config.get('HOST', 'localhost')
        db_port = db_config.get('PORT', '5432')

        logger.info(f"[SQL_TO_JSON] Converting {sql_file_path} to JSON format")

        # STEP 1: Create a temporary database
        temp_db_name = f"temp_convert_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        logger.info(f"[SQL_TO_JSON] Creating temporary database: {temp_db_name}")

        conn = psycopg2.connect(
            dbname='postgres',
            user=db_user,
            password=db_password,
            host=db_host,
            port=db_port
        )
        conn.set_isolation_level(0)  # AUTOCOMMIT
        cursor = conn.cursor()

        # Drop temp DB if exists
        cursor.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(
            sql.Identifier(temp_db_name)
        ))

        # Create temp DB
        cursor.execute(sql.SQL("CREATE DATABASE {}").format(
            sql.Identifier(temp_db_name)
        ))

        cursor.close()
        conn.close()

        logger.info(f"[SQL_TO_JSON] Temporary database created")

        # STEP 2: Restore SQL to temp DB
        logger.info(f"[SQL_TO_JSON] Restoring SQL to temporary database...")

        cmd = [
            'psql',
            '--username', db_user,
            '--host', db_host,
            '--port', str(db_port),
            '--dbname', temp_db_name,
            '--file', str(sql_file_path),
            '--quiet'
        ]

        env = os.environ.copy()
        env['PGPASSWORD'] = db_password

        import subprocess
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            logger.error(f"[SQL_TO_JSON] Failed to restore SQL to temp DB")
            logger.error(f"[SQL_TO_JSON] stderr: {result.stderr}")
            # Clean up temp DB
            conn = psycopg2.connect(dbname='postgres', user=db_user, password=db_password,
                                   host=db_host, port=db_port)
            conn.set_isolation_level(0)
            cursor = conn.cursor()
            cursor.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(temp_db_name)))
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': _('Failed to restore SQL backup to temporary database'),
                'details': result.stderr
            }

        logger.info(f"[SQL_TO_JSON] SQL restored to temporary database")

        # STEP 3: Dump temp DB to JSON using Django
        # Temporarily change DB settings
        original_db_name = settings.DATABASES['default']['NAME']
        settings.DATABASES['default']['NAME'] = temp_db_name

        logger.info(f"[SQL_TO_JSON] Dumping temporary database to JSON...")

        output = StringIO()
        call_command(
            'dumpdata',
            'finances',
            format='json',
            indent=2,
            use_natural_foreign_keys=True,
            use_natural_primary_keys=True,
            stdout=output,
            verbosity=0
        )

        # Restore DB setting
        settings.DATABASES['default']['NAME'] = original_db_name

        json_data = output.getvalue()
        objects = json.loads(json_data)

        # STEP 4: Extract family metadata
        family_meta = {'id': None, 'name': 'Unknown'}

        for obj in objects:
            if obj['model'] == 'finances.family':
                family_meta['id'] = obj['fields']['id']
                family_meta['name'] = obj['fields']['name']
                break

        # STEP 5: Create JSON backup file
        if output_path is None:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            safe_name = "".join(c for c in family_meta['name'] if c.isalnum() or c in (' ', '-', '_')).strip()
            safe_name = safe_name.replace(' ', '_')
            output_path = Path(tempfile.gettempdir()) / f"backup_{safe_name}_{timestamp}.json"

        backup_data = {
            'version': '2.0',
            'family': family_meta,
            'generated': datetime.now().isoformat(),
            'converted_from': 'sql',
            'objects': objects
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(backup_data, f, indent=2, ensure_ascii=False)

        logger.info(f"[SQL_TO_JSON] JSON backup created: {output_path}")

        # STEP 6: Clean up temp DB
        logger.info(f"[SQL_TO_JSON] Cleaning up temporary database...")

        conn = psycopg2.connect(
            dbname='postgres',
            user=db_user,
            password=db_password,
            host=db_host,
            port=db_port
        )
        conn.set_isolation_level(0)
        cursor = conn.cursor()

        # Close all connections to temp DB
        cursor.execute("""
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = %s
            AND pid <> pg_backend_pid();
        """, (temp_db_name,))

        cursor.execute(sql.SQL("DROP DATABASE {}").format(
            sql.Identifier(temp_db_name)
        ))

        cursor.close()
        conn.close()

        logger.info(f"[SQL_TO_JSON] Conversion completed successfully")

        return {
            'success': True,
            'json_path': str(output_path),
            'family_name': family_meta['name'],
            'objects_count': len(objects)
        }

    except Exception as e:
        logger.error(f"[SQL_TO_JSON] Conversion failed: {e}", exc_info=True)
        return {
            'success': False,
            'error': _('Conversion failed: %(error)s') % {'error': str(e)}
        }
