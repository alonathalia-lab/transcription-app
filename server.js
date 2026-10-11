/**
 * Servidor de Transcrição em Tempo Real
 * Integração com Whisper, Pyannote e Firebase
 */

const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const morgan = require('morgan');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
require('dotenv').config();

// Inicialização da app
const app = express();
expressWs(app);

// Middlewares
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Armazenamento em memória (substituir por Firebase em produção)
const activeSessions = new Map();
const userVoiceProfiles = new Map();

/**
 * ==========================================
 * ROTA RAIZ
 * ==========================================
 */
app.get('/', (req, res) => {
  res.json({
    status: 'Servidor de Transcrição em Tempo Real',
    version: '1.0.0',
    endpoints: [
      'POST /api/transcribe - Transcrever áudio',
      'GET /api/sessions/:sessionId - Obter sessão',
      'POST /api/voice-profiles - Criar perfil de voz',
      'GET /api/voice-profiles/:userId - Obter perfis de voz',
      'WS /ws/transcribe - WebSocket para streaming'
    ]
  });
});

/**
 * ==========================================
 * ROTA: Transcrição por Upload
 * ==========================================
 */
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioData, userId, conversationId } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'Audio data required' });
    }

    // Converter base64 para buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    const audioPath = path.join('/tmp', `audio-${uuidv4()}.wav`);

    fs.writeFileSync(audioPath, audioBuffer);

    // Processar áudio: Transcrição + Speaker Diarization
    const result = await processAudio(audioPath, userId);

    // Limpar arquivo temporário
    fs.unlinkSync(audioPath);

    res.json({
      success: true,
      conversationId: conversationId || uuidv4(),
      transcription: result.transcription,
      speakers: result.speakers,
      duration: result.duration
    });
  } catch (error) {
    console.error('Erro na transcrição:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ==========================================
 * WEBSOCKET: Streaming em Tempo Real
 * ==========================================
 */
app.ws('/ws/transcribe', (ws, req) => {
  const sessionId = uuidv4();
  const chunks = [];

  console.log(`📞 Nova sessão WebSocket: ${sessionId}`);

  activeSessions.set(sessionId, {
    ws,
    startTime: Date.now(),
    transcriptions: []
  });

  // Enviar confirmação de conexão
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    message: 'Conectado ao servidor de transcrição'
  }));

  // Receber chunks de áudio
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'audio_chunk':
          // Processar chunk de áudio
          chunks.push(Buffer.from(message.data, 'base64'));

          // Se houver 10+ chunks (aproximadamente 1 segundo), processar
          if (chunks.length >= 10) {
            await processAudioChunks(sessionId, chunks, message.userId);
            chunks.length = 0; // Limpar chunks
          }
          break;

        case 'end_session':
          // Finalizar sessão e retornar transcrição completa
          const session = activeSessions.get(sessionId);
          if (session) {
            ws.send(JSON.stringify({
              type: 'session_end',
              transcriptions: session.transcriptions,
              duration: Date.now() - session.startTime
            }));
            activeSessions.delete(sessionId);
          }
          ws.close();
          break;

        case 'name_speaker':
          // Nomear falante
          await nameSpeaker(
            message.userId,
            message.speakerId,
            message.speakerName
          );
          ws.send(JSON.stringify({
            type: 'speaker_named',
            speakerId: message.speakerId,
            name: message.speakerName
          }));
          break;

        default:
          console.log('Tipo de mensagem desconhecido:', message.type);
      }
    } catch (error) {
      console.error('Erro no WebSocket:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });

  ws.on('error', (error) => {
    console.error(`Erro na sessão ${sessionId}:`, error);
    activeSessions.delete(sessionId);
  });

  ws.on('close', () => {
    console.log(`❌ Sessão encerrada: ${sessionId}`);
    activeSessions.delete(sessionId);
  });
});

/**
 * ==========================================
 * ROTA: Gerenciar Perfis de Voz
 * ==========================================
 */
app.post('/api/voice-profiles', async (req, res) => {
  try {
    const { userId, speakerName, audioData } = req.body;

    if (!userId || !speakerName || !audioData) {
      return res.status(400).json({
        error: 'userId, speakerName e audioData são obrigatórios'
      });
    }

    const speakerId = uuidv4();

    // Extrair embedding de voz (usar Python script)
    const voiceEmbedding = await extractVoiceEmbedding(audioData);

    // Armazenar perfil de voz
    if (!userVoiceProfiles.has(userId)) {
      userVoiceProfiles.set(userId, []);
    }

    const profile = {
      speakerId,
      name: speakerName,
      voiceEmbedding,
      createdAt: new Date().toISOString()
    };

    userVoiceProfiles.get(userId).push(profile);

    res.json({
      success: true,
      speakerId,
      message: 'Perfil de voz criado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao criar perfil de voz:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ==========================================
 * ROTA: Obter Perfis de Voz
 * ==========================================
 */
app.get('/api/voice-profiles/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const profiles = userVoiceProfiles.get(userId) || [];

    res.json({
      success: true,
      userId,
      profiles: profiles.map(p => ({
        speakerId: p.speakerId,
        name: p.name,
        createdAt: p.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ==========================================
 * ROTA: Obter Sessão
 * ==========================================
 */
app.get('/api/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada' });
    }

    res.json({
      success: true,
      sessionId,
      isActive: true,
      duration: Date.now() - session.startTime,
      transcriptionCount: session.transcriptions.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ==========================================
 * FUNÇÕES DE PROCESSAMENTO
 * ==========================================
 */

/**
 * Processar áudio: Transcrever + Speaker Diarization
 */
async function processAudio(audioPath, userId) {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [
      path.join(__dirname, 'audio_processor.py'),
      audioPath,
      userId
    ]);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python error:', errorOutput);
        return reject(new Error(errorOutput || 'Python processing failed'));
      }

      try {
        const result = JSON.parse(output);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Processar chunks de áudio em tempo real
 */
async function processAudioChunks(sessionId, chunks, userId) {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const audioBuffer = Buffer.concat(chunks);
    const audioPath = path.join('/tmp', `audio-chunk-${uuidv4()}.wav`);
    fs.writeFileSync(audioPath, audioBuffer);

    const result = await processAudio(audioPath, userId);

    // Adicionar à sessão
    session.transcriptions.push(...result.transcription);

    // Enviar ao cliente via WebSocket
    session.ws.send(JSON.stringify({
      type: 'transcription_update',
      data: result.transcription,
      speakers: result.speakers
    }));

    fs.unlinkSync(audioPath);
  } catch (error) {
    console.error('Erro ao processar chunks:', error);
  }
}

/**
 * Extrair embedding de voz
 */
async function extractVoiceEmbedding(audioData) {
  return new Promise((resolve, reject) => {
    const python = spawn('python3', [
      path.join(__dirname, 'voice_embedding.py')
    ]);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.stdin.write(audioData);
    python.stdin.end();

    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(errorOutput || 'Embedding extraction failed'));
      }

      try {
        const embedding = JSON.parse(output);
        resolve(embedding);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Nomear falante
 */
async function nameSpeaker(userId, speakerId, speakerName) {
  const profiles = userVoiceProfiles.get(userId) || [];
  const profile = profiles.find(p => p.speakerId === speakerId);

  if (profile) {
    profile.name = speakerName;
  }
}

/**
 * ==========================================
 * INICIAR SERVIDOR
 * ==========================================
 */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║  🎙️  SERVIDOR DE TRANSCRIÇÃO             ║
  ║                                           ║
  ║  Rodando em: http://localhost:${PORT}   ║
  ║  WebSocket: ws://localhost:${PORT}/ws   ║
  ║                                           ║
  ║  Versão: 1.0.0                           ║
  ║  Pronto para transcrever! 🚀              ║
  ╚═══════════════════════════════════════════╝
  `);
});

module.exports = app;
