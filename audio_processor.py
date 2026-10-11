#!/usr/bin/env python3
"""
Processador de Áudio: Transcrição + Speaker Diarization
Usa: Whisper (transcrição) + Pyannote (identificação de falante)
"""

import sys
import json
import numpy as np
from pathlib import Path

try:
    import whisper
    from pyannote.audio import Pipeline
    import torch
except ImportError:
    print(json.dumps({
        "error": "Dependencies not installed. Run: pip install openai-whisper pyannote.audio torch"
    }))
    sys.exit(1)

# Configurar device (CPU ou GPU)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[INFO] Usando device: {DEVICE}", file=sys.stderr)

# Carregar modelos
print("[INFO] Carregando modelo Whisper...", file=sys.stderr)
whisper_model = whisper.load_model("base")

print("[INFO] Carregando pipeline Pyannote...", file=sys.stderr)
diarization_pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.0",
    use_auth_token="hf_YOUR_HUGGINGFACE_TOKEN"  # Obter gratuitamente em huggingface.co
)
diarization_pipeline.to(DEVICE)

def process_audio_file(audio_path):
    """
    Processar arquivo de áudio
    Retorna: transcrição + identificação de falante
    """

    try:
        # Step 1: Transcrição com Whisper
        print(f"[INFO] Transcrever áudio: {audio_path}", file=sys.stderr)
        result = whisper_model.transcribe(audio_path, language="pt")

        transcription_text = result["text"]
        segments = result["segments"]

        # Step 2: Speaker Diarization com Pyannote
        print("[INFO] Identificando falantes...", file=sys.stderr)
        diarization = diarization_pipeline(audio_path)

        # Step 3: Mapear transcrição para falantes
        transcription_with_speakers = match_transcription_to_speakers(
            segments,
            diarization
        )

        # Step 4: Calcular duração
        import librosa
        y, sr = librosa.load(audio_path)
        duration = librosa.get_duration(y=y, sr=sr)

        # Extrair lista única de falantes
        speakers = list(set(item["speaker"] for item in transcription_with_speakers))

        response = {
            "success": True,
            "transcription": transcription_with_speakers,
            "speakers": speakers,
            "duration": round(duration, 2),
            "full_text": transcription_text,
            "confidence": result.get("confidence", 0.0)
        }

        return response

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def match_transcription_to_speakers(segments, diarization):
    """
    Mapear cada segmento de transcrição a um falante
    """
    result = []

    for segment in segments:
        start_time = segment["start"]
        end_time = segment["end"]
        text = segment["text"].strip()

        if not text:
            continue

        # Encontrar falante durante este intervalo de tempo
        speaker = find_speaker_at_time(diarization, start_time, end_time)

        result.append({
            "speaker": speaker,
            "text": text,
            "start": start_time,
            "end": end_time,
            "confidence": segment.get("confidence", 0.0)
        })

    return result

def find_speaker_at_time(diarization, start, end):
    """
    Encontrar qual falante está ativo durante um intervalo de tempo
    """
    mid_point = (start + end) / 2

    for segment, track, speaker in diarization.itertracks(yield_label=True):
        if segment.start <= mid_point <= segment.end:
            return f"speaker_{speaker}"

    return "speaker_unknown"

def extract_voice_embedding(audio_path, user_id):
    """
    Extrair embedding único de voz para reconhecimento futuro
    """
    try:
        # Usar Pyannote para extrair embedding
        from pyannote.audio import Embedding

        embedding_model = Embedding.from_pretrained(
            "pyannote/embedding"
        )
        embedding_model.to(DEVICE)

        waveform, sample_rate = torchaudio.load(audio_path)
        embedding = embedding_model(waveform.to(DEVICE))

        return embedding.cpu().numpy().tolist()

    except Exception as e:
        print(f"[WARNING] Erro ao extrair embedding: {e}", file=sys.stderr)
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Audio path required"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    user_id = sys.argv[2] if len(sys.argv) > 2 else "default"

    result = process_audio_file(audio_path)
    print(json.dumps(result))
