require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';
// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Enable CORS for development
const cors = require('cors');
app.use(cors());

// System instructions for Revolt Motors (properly formatted for Gemini API)
const SYSTEM_INSTRUCTIONS = {
    parts: [{
        text: `You are Rev, the AI assistant for Revolt Motors, India's leading electric motorcycle company. Your role is to help customers with information about Revolt electric motorcycles, booking process, specifications, pricing, charging infrastructure, service centers, test drives, EMI options, and warranty information.

Key Information about Revolt Motors:
- Founded in 2019, pioneering electric mobility in India
- Models include RV400 and RV1 series with smart connected features
- Features mobile app connectivity, multiple riding modes, and removable batteries
- Focuses on sustainable and eco-friendly transportation
- Has service centers across major Indian cities

Always be helpful, enthusiastic about electric mobility, and focus on Revolt Motors products and services. If asked about competitors or unrelated topics, politely redirect the conversation back to Revolt Motors. Keep responses conversational, natural, and informative. You can speak in English and Hindi as needed.`
    }]
};

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Client connected');
    
    let liveSession = null;
    let isSessionActive = false;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'start_session':
                    await startLiveSession(ws, data);
                    break;
                    
                case 'audio_data':
                    if (liveSession && isSessionActive) {
                        await handleAudioData(liveSession, data.audio);
                    }
                    break;

                case 'text_input':
                    if (liveSession && isSessionActive) {
                        await handleTextInput(liveSession, data.text);
                    }
                    break;
                    
                case 'end_session':
                    if (liveSession) {
                        await endLiveSession(liveSession);
                        liveSession = null;
                        isSessionActive = false;
                    }
                    break;
                    
                case 'interrupt':
                    if (liveSession && isSessionActive) {
                        await handleInterruption(liveSession);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: error.message
            }));
        }
    });

    async function startLiveSession(ws, data) {
        try {
            // Initialize Gemini Live session with proper configuration
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash", // Use this for development
                systemInstruction: SYSTEM_INSTRUCTIONS,
                generationConfig: {
                    temperature: 0.8,
                    topP: 0.95,
                    topK: 40,
                    maxOutputTokens: 1024,
                    
                }
            });

            // Start chat session
            liveSession = model.startChat({
                history: [],
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    },
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH", 
                        threshold: "BLOCK_MEDIUM_AND_ABOVE"
                    }
                ]
            });
            
            isSessionActive = true;
            
            ws.send(JSON.stringify({
                type: 'session_started',
                sessionId: 'session_' + Date.now(),
                message: 'Hello! I\'m Rev, your Revolt Motors assistant. How can I help you with our electric motorcycles today?'
            }));

            console.log('Live session started successfully');
            
        } catch (error) {
            console.error('Error starting live session:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to start live session: ' + error.message
            }));
        }
    }

    async function handleAudioData(session, audioData) {
        try {
            // For now, we'll use text-based interaction since the native audio models
            // have specific requirements. You can implement direct audio processing
            // when using the native audio dialog model in production.
            
            // Convert audio to text using Web Speech API on client side
            // and send text here, or use a speech-to-text service
            
            // For demonstration, we'll handle text input
            // In production, you'd integrate with speech recognition
            
            ws.send(JSON.stringify({
                type: 'processing_audio',
                message: 'Processing your voice input...'
            }));
            
        } catch (error) {
            console.error('Error handling audio data:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process audio: ' + error.message
            }));
        }
    }

    async function handleTextInput(session, text) {
        try {
            console.log('Processing text input:', text);
            
            const result = await session.sendMessage(text);
            const responseText = await result.response.text();
            
            // Send text response
            ws.send(JSON.stringify({
                type: 'text_response',
                text: responseText
            }));

            // Convert text to speech (you can integrate with a TTS service)
            // For now, we'll let the client handle TTS
            ws.send(JSON.stringify({
                type: 'tts_request',
                text: responseText
            }));
            
        } catch (error) {
            console.error('Error processing text input:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process input: ' + error.message
            }));
        }
    }

    async function handleInterruption(session) {
        try {
            // Stop current generation and prepare for new input
            // The Gemini Live API handles this natively
            ws.send(JSON.stringify({
                type: 'interruption_handled'
            }));
            
        } catch (error) {
            console.error('Error handling interruption:', error);
        }
    }

    async function endLiveSession(session) {
        try {
            // Clean up the session
            isSessionActive = false;
            console.log('Live session ended');
            
        } catch (error) {
            console.error('Error ending session:', error);
        }
    }

    ws.on('close', () => {
        console.log('Client disconnected');
        if (liveSession) {
            endLiveSession(liveSession);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API endpoint for testing
app.post('/api/test', async (req, res) => {
    try {
        const { message } = req.body;
        
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-live-001",
            systemInstruction: SYSTEM_INSTRUCTIONS
        });

        const result = await model.generateContent(message);
        const response = result.response.text();
        
        res.json({ response });
        
    } catch (error) {
        console.error('Error in test endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log(`Web interface: http://localhost:${PORT}`);
});

module.exports = app;