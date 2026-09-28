"""Génère les clés VAPID des notifications push (une seule fois), à copier dans les variables Railway du service API.

    python scripts/gen_vapid.py
"""
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01, b64urlencode

v = Vapid01()
v.generate_keys()
private = b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32, "big"))
public = b64urlencode(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
print(f"VAPID_PUBLIC_KEY={public}")
print(f"VAPID_PRIVATE_KEY={private}")
print("VAPID_SUBJECT=mailto:ton@email.fr")
