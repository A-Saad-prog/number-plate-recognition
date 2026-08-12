import base64
import io
import secrets

import qrcode


def generate_qr_code() -> str:
    """
    Generate a unique identifier for a parking session.
    """

    return f"PARK-{secrets.token_hex(8).upper()}"


def generate_qr_image(qr_code_value: str) -> str:
    """
    Generate a QR code image and return it as a Base64 string.
    """

    qr = qrcode.QRCode(
        version=1,
        box_size=10,
        border=4,
    )

    qr.add_data(qr_code_value)
    qr.make(fit=True)

    image = qr.make_image()

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    image_bytes = buffer.getvalue()

    return base64.b64encode(image_bytes).decode("utf-8")