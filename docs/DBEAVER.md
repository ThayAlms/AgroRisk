# Conectar o PostgreSQL do AgroRisk no DBeaver

O banco de produção é PostgreSQL hospedado no Neon e já está conectado à Vercel. O DBeaver é apenas o programa cliente usado para visualizar e administrar esse banco.

1. Abra o DBeaver e escolha **Nova conexão > PostgreSQL**.
2. No painel da Vercel, abra **AgroRisk > Storage > neon-cinnabar-button**.
3. Copie os campos da conexão não agrupada (`PGHOST_UNPOOLED`, `PGDATABASE`, `PGUSER` e `PGPASSWORD`).
4. No DBeaver, use a porta `5432`, marque **SSL**, selecione o modo `require` e teste a conexão.
5. Nunca salve a senha em arquivo versionado ou envie a senha pelo chat.

As tabelas criadas automaticamente são `telemetry`, `device_configs`, `safety_logs`, `danger_zones`, `device_commands` e `device_locations`. O arquivo [db/schema.sql](../db/schema.sql) documenta o esquema completo.
