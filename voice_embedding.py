#!/usr/bin/env python3
"""
Extração de Voice Embedding para Reconhecimento de Falante
Usa deep learning para criar representação numérica única da voz
"""

import json
import sys
import numpy as np
from io import BytesIO

try:
    import torch
    import torchaudio
    from pyannote.audio import Embedding
except ImportError:
    print(json.dumps({
        "error": "Dependencies missing. Run: pip install torch torchaudio pyannote.audio"
    }))
    sys.exit(1)

# Configurar device
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

def extract_embedding_from_bytes(audio_bytes):
    """
    Extrair embedding de voz a partir de bytes de áudio

    Retorna: lista de 512 números (representação da voz)
    """
    try:
        # Carregar modelo de embedding
        print("[INFO] Carregando modelo de embedding...", file=sys.stderr)
        embedding_model = Embedding.from_pretrained("pyannote/embedding")
        embedding_model.to(DEVICE)
        embedding_model.eval()

        # Converter bytes para waveform
        audio_tensor, sample_rate = torchaudio.load(BytesIO(audio_bytes))

        # Resample se necessário (modelo espera 16kHz)
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            audio_tensor = resampler(audio_tensor)
            sample_rate = 16000

        # Extrair embedding
        with torch.no_grad():
            embedding = embedding_model(audio_tensor.to(DEVICE))

        # Converter para lista Python
        embedding_list = embedding.cpu().numpy().flatten().tolist()

        return {
            "success": True,
            "embedding": embedding_list,
            "dimension": len(embedding_list),
            "device": DEVICE
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def compare_embeddings(embedding1, embedding2):
    """
    Comparar dois embeddings e retornar similaridade (0-1)
    Usa cosine similarity
    """
    try:
        e1 = np.array(embedding1)
        e2 = np.array(embedding2)

        # Cosine similarity
        similarity = np.dot(e1, e2) / (np.linalg.norm(e1) * np.linalg.norm(e2))

        return {
            "similarity": float(similarity),
            "is_same_speaker": similarity > 0.7  # Threshold de 70%
        }
    except Exception as e:
        return {
            "error": str(e)
        }

if __name__ == "__main__":
    # Ler áudio do stdin
    audio_bytes = sys.stdin.buffer.read() if hasattr(sys.stdin, 'buffer') else sys.stdin.read()

    if not audio_bytes:
        print(json.dumps({"error": "No audio data received"}))
        sys.exit(1)

    result = extract_embedding_from_bytes(audio_bytes)
    print(json.dumps(result))
