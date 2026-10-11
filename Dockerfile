# Multi-stage build para backend de transcrição
# Build: Node.js + Python

# ==========================================
# Stage 1: Base Python com Pyannote
# ==========================================
FROM python:3.10-slim as python-base

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    build-essential \
    libffi-dev \
    libssl-dev \
    libsndfile1 \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements Python
COPY requirements.txt ./requirements.txt

# Instalar dependências Python
RUN pip install --no-cache-dir -r requirements.txt

# ==========================================
# Stage 2: Build Node.js
# ==========================================
FROM node:18-alpine as node-builder

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json

RUN npm ci --only=production

# ==========================================
# Stage 3: Final Image
# ==========================================
FROM python:3.10-slim

WORKDIR /app

# Instalar apenas dependências de runtime
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copiar Python do stage 1
COPY --from=python-base /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=python-base /usr/local/bin /usr/local/bin

# Copiar Node.js do stage 2
COPY --from=node-builder /app/node_modules ./node_modules

# Copiar arquivos do app
COPY server.js ./server.js
COPY audio_processor.py ./audio_processor.py
COPY voice_embedding.py ./voice_embedding.py
COPY package.json ./package.json
COPY .env.example ./.env

# Instalar Node.js runtime
RUN apt-get update && apt-get install -y \
    curl \
    && curl -sL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/ || exit 1

# Expor porta
EXPOSE ${PORT:-3000}

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Iniciar aplicação
CMD ["node", "server.js"]
   # Rebuild trigger
