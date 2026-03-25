"""
PostgreSQL Sequence Reset Utilities

This module provides functions to reset PostgreSQL sequences after
data import operations (backup restore, migration, etc.).

The issue: When data is imported with explicit IDs (via loaddata or INSERT),
PostgreSQL's auto-increment sequences don't automatically update.
This causes duplicate key errors when new records are created.

Solution: After any data import, reset sequences to MAX(id) + 1.
"""

import logging
from django.db import connection

logger = logging.getLogger(__name__)


def reset_postgres_sequences(app_label='finances'):
    """
    Reset all PostgreSQL sequences for a given app to the correct values.

    This function uses a direct approach: query all sequences in the app's schema
    and reset each one to MAX(id) + 1 for the corresponding table.

    Args:
        app_label (str): Django app label (default: 'finances')

    Returns:
        dict: {'success': bool, 'sequences_reset': int, 'error': str}
    """
    if connection.vendor != 'postgresql':
        logger.debug(f"[SEQUENCE_RESET] Skipping - not PostgreSQL (vendor: {connection.vendor})")
        return {
            'success': True,
            'sequences_reset': 0,
            'note': 'Not a PostgreSQL database'
        }

    try:
        from django.apps import apps

        logger.info(f"[SEQUENCE_RESET] Resetting sequences for app '{app_label}'...")

        # Get all models for this app
        app_config = apps.get_app_config(app_label)
        models_list = app_config.get_models()

        success_count = 0
        with connection.cursor() as cursor:
            for model in models_list:
                table_name = model._meta.db_table
                sequence_name = f'{table_name}_id_seq'

                # Check if sequence exists
                cursor.execute("""
                    SELECT 1 FROM pg_sequences
                    WHERE schemaname = 'public'
                    AND sequencename = %s
                """, [sequence_name])

                if not cursor.fetchone():
                    # Sequence doesn't exist, skip
                    logger.debug(f"[SEQUENCE_RESET] Sequence {sequence_name} does not exist, skipping")
                    continue

                # Get current max ID from the table
                cursor.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table_name}")
                max_id = cursor.fetchone()[0]

                # Reset sequence to max_id + 1, or 1 if table is empty
                new_value = max_id + 1
                cursor.execute(
                    f"SELECT setval(%s, %s, false)",
                    [sequence_name, new_value]
                )

                # Verify
                cursor.execute(f"SELECT last_value FROM {sequence_name}")
                last_value = cursor.fetchone()[0]

                success_count += 1
                logger.debug(f"[SEQUENCE_RESET] Reset {sequence_name}: max_id={max_id}, new_value={last_value}")

        logger.info(f"[SEQUENCE_RESET] Successfully reset {success_count} sequences")
        return {
            'success': True,
            'sequences_reset': success_count
        }

    except Exception as e:
        logger.error(f"[SEQUENCE_RESET] Failed: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e)
        }


def reset_all_postgres_sequences():
    """
    Reset sequences for ALL installed Django apps.

    This is useful after a full database restore or migration.

    Returns:
        dict: {'success': bool, 'apps_reset': list, 'total_sequences': int}
    """
    from django.apps import apps

    logger.info(f"[SEQUENCE_RESET] ========== RESETTING ALL SEQUENCES ==========")

    results = {
        'success': True,
        'apps_reset': [],
        'total_sequences': 0,
        'errors': []
    }

    # Get all installed apps with models
    for app_config in apps.get_app_configs():
        if app_config.models_module:
            result = reset_postgres_sequences(app_config.label)

            if result['success']:
                seq_count = result.get('sequences_reset', 0)
                if seq_count > 0:
                    results['apps_reset'].append({
                        'app': app_config.label,
                        'sequences': seq_count
                    })
                    results['total_sequences'] += seq_count
            else:
                results['success'] = False
                results['errors'].append({
                    'app': app_config.label,
                    'error': result.get('error')
                })

    logger.info(f"[SEQUENCE_RESET] ========== COMPLETE: {results['total_sequences']} sequences reset ==========")

    return results


def reset_sequence_for_table(table_name):
    """
    Reset a single table's sequence to MAX(id) + 1.

    This is useful for targeted fixes when only one table has issues.

    Args:
        table_name (str): Database table name (e.g., 'finances_period')

    Returns:
        dict: {'success': bool, 'old_value': int, 'new_value': int}
    """
    if connection.vendor != 'postgresql':
        return {
            'success': False,
            'error': 'Not a PostgreSQL database'
        }

    try:
        with connection.cursor() as cursor:
            # Get the current sequence value
            sequence_name = f'{table_name}_id_seq'
            cursor.execute(f"SELECT last_value FROM {sequence_name}")
            old_value = cursor.fetchone()[0]

            # Reset to MAX(id) + 1
            cursor.execute(
                f"SELECT setval('{sequence_name}', (SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}), false)"
            )
            cursor.execute(f"SELECT last_value FROM {sequence_name}")
            new_value = cursor.fetchone()[0]

            logger.info(f"[SEQUENCE_RESET] Reset {sequence_name}: {old_value} -> {new_value}")

            return {
                'success': True,
                'sequence': sequence_name,
                'old_value': old_value,
                'new_value': new_value
            }

    except Exception as e:
        logger.error(f"[SEQUENCE_RESET] Failed to reset {table_name}: {e}")
        return {
            'success': False,
            'error': str(e)
        }
