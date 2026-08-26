"""Parametros centralizados das regras de negocio do MVP."""

CAMPOS_OBRIGATORIOS = (
    "timestamp",
    "device_id",
    "distance_cm",
    "temperature_c",
    "humidity_pct",
    "tilt_deg",
    "speed_kmh",
)

CAMPOS_NUMERICOS = (
    "distance_cm",
    "temperature_c",
    "humidity_pct",
    "tilt_deg",
    "speed_kmh",
)

LIMITES_VALIDOS = {
    "distance_cm": (0, 10000),
    "temperature_c": (-40, 85),
    "humidity_pct": (0, 100),
    "tilt_deg": (0, 90),
    "speed_kmh": (0, 80),
}

COLUNAS_OPCIONAIS = {
    "inside_geofence": True,
    "danger_zone": "safe",
    "buzzer": False,
    "source": "external",
}

