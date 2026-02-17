-- Seed default image generation unit cost (USD per image)
INSERT INTO app_settings (key, value, description)
VALUES ('image_cost_usd_per_image', '0.04', 'Estimated USD cost per generated image for scheduler cost breakdown')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description;

