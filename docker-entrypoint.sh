#!/bin/sh
set -e

echo "🔮 Nexus — Starting up..."

# Push database schema
echo "📦 Setting up database..."
npx prisma db push --skip-generate

echo "✅ Database ready"
echo "🚀 Starting Nexus on port 3000..."

exec node server.js
