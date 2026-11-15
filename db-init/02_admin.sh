#!/bin/sh
# Анх асахад нэг удаа ажиллана: .env-ийн ADMIN_EMAIL / ADMIN_PASSWORD-оор админ үүсгэнэ.
# Нууц үг bcrypt-ээр (pgcrypto) хадгалагдана, жинхэнэ утга сандаа үлдэхгүй.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -v email="$ADMIN_EMAIL" -v pass="$ADMIN_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO admins (email, password_hash)
VALUES (:'email', crypt(:'pass', gen_salt('bf', 12)));
SQL
