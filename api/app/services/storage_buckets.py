"""Shared Supabase Storage helpers.

The one thing worth knowing here: the service role can create a bucket over
the Storage API, so a feature that stores images does not have to fail its
first upload telling whoever is standing in Admin to go and run SQL. (Adding
a *column* is different - that is DDL, PostgREST has none, and this backend
has no direct Postgres connection, so column migrations stay manual.)
"""

import logging

logger = logging.getLogger(__name__)


def ensure_public_bucket(storage, bucket_id: str, max_bytes: int, mime_types) -> bool:
    """Create a public-read bucket if it isn't there yet.

    Buckets created this way get **no storage policies at all**, which is the
    deliberate arrangement for every bucket the backend owns: nothing but the
    service role can write, and reads go through each object's public URL.

    Returns whether the bucket can be considered present - a failure is logged
    and reported, never raised, so the caller decides what to do about it.
    """
    try:
        storage.create_bucket(
            bucket_id,
            bucket_id,
            {
                "public": True,
                "file_size_limit": max_bytes,
                "allowed_mime_types": list(mime_types),
            },
        )
        logger.info(f"Created the {bucket_id} storage bucket")
        return True
    except Exception as e:
        # Someone else created it first (a race, or the SQL was run) - that is
        # the outcome we wanted, not a failure.
        if "already exist" in str(e).lower():
            return True
        logger.warning(f"Could not create the {bucket_id} bucket: {e}")
        return False
