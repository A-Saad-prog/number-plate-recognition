import os
import uuid

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, HTTPException, UploadFile

router = APIRouter(
    prefix="/storage",
    tags=["Storage test"],
)


@router.post("/test")
async def test_storage_round_trip(image: UploadFile = File(...)):
    """Upload, download, compare, and delete one temporary storage object."""
    bucket = os.getenv("AWS_S3_BUCKET")
    endpoint_url = os.getenv("AWS_ENDPOINT_URL_S3")
    region = os.getenv("AWS_REGION")

    if not bucket:
        raise HTTPException(
            status_code=503,
            detail="AWS_S3_BUCKET is not configured.",
        )

    if not endpoint_url:
        raise HTTPException(
            status_code=503,
            detail="AWS_ENDPOINT_URL_S3 is not configured.",
        )

    original_bytes = await image.read()
    if not original_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")

    object_key = f"_storage_test/{uuid.uuid4().hex}-{image.filename or 'image.bin'}"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )

    try:
        client.put_object(
            Bucket=bucket,
            Key=object_key,
            Body=original_bytes,
            ContentType=image.content_type or "application/octet-stream",
        )
        downloaded_bytes = client.get_object(Bucket=bucket, Key=object_key)[
            "Body"
        ].read()

        if downloaded_bytes != original_bytes:
            raise HTTPException(
                status_code=502,
                detail="Storage round trip returned different image bytes.",
            )

        return {
            "success": True,
            "uploaded": True,
            "retrieved": True,
            "bytes_match": True,
            "size_bytes": len(original_bytes),
        }
    except (BotoCoreError, ClientError) as error:
        raise HTTPException(
            status_code=502,
            detail=f"Storage round trip failed: {error.__class__.__name__}",
        ) from error
    finally:
        try:
            client.delete_object(Bucket=bucket, Key=object_key)
        except (BotoCoreError, ClientError):
            pass
