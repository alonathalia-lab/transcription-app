# Imagem Python base
FROM python:3.10-slim

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    nodejs \
    npm \
    ffmpeg \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements e package files
COPY requirements.txt ./
COPY package.json ./
COPY package-lock.json . 2>/dev/null || true

# Instalar PyTorch CPU pré-compilado (MUITO mais rápido!)
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Instalar resto das dependências Python
RUN pip install --no-cache-dir -r requirements.txt

# Instalar dependências Node.js
RUN npm ci --only=production

# Copiar arquivos da aplicação
COPY server.js ./
COPY audio_processor.py ./
COPY voice_embedding.py ./
COPY .env.example ./.env

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Expor porta
EXPOSE 3000

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Iniciar aplicação
CMD ["node", "server.js"]
