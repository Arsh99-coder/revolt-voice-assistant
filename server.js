const express = require('express');
const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System instructions for Revolt Motors
const SYSTEM_INSTRUCTIONS = `You are Rev, the official voice assistant for Revolt Motors, India's leading electric motorcycle company. Your role is to help customers with information about Revolt's electric motorcycles, particularly the RV400 and RV400 BRZ models.

Key Information about Revolt Motors:
- Founded to revolutionize Indian transportation with electric motorcycles
- Flagship models: RV400 and RV400 BRZ
- Features: AI-enabled, app-controlled, customizable exhaust sounds, 150km range
- Top speed: 85 kmph, can charge in 4.5 hours
- Mobile app control: start/stop, locate, lock/unlock, hazard alerts
- Voice assistance integration for hands-free control
- Booking available for just ₹499
- Eco-friendly and sustainable transportation solution

Guidelines:
- Keep responses concise and conversational
- Focus only on Revolt Motors products and services
- If asked about competitors or unrelated topics, politely redirect to Revolt Motors
- Be enthusiastic about electric mobility and Revolt's innovation
- Provide helpful information about features, pricing, booking, and specifications
- Encourage test rides and bookings when appropriate

Always maintain a friendly, knowledgeable, and professional tone while being passionate about Revolt Motors and electric mobility.`;

// Create HTTP server
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store active connections
const activeConnections = new Map();

wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    
    const connectionId = Math.random().toString(36).substr(2, 9);
    activeConnections.set(connectionId, { ws, isListening: false });

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const connection = activeConnections.get(connectionId);
            
            switch (data.type) {
                case 'start_conversation':
                    await handleStartConversation(ws, connectionId);
                    break;
                    
                case 'audio_data':
                    await handleAudioData(ws, connectionId, data.audio);
                    break;
                    
                case 'natural_interrupt':
                    await handleNaturalInterrupt(ws, connectionId);
                    break;
                    
                case 'end_conversation':
                    await handleEndConversation(ws, connectionId);
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Failed to process message' 
            }));
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed');
        activeConnections.delete(connectionId);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        activeConnections.delete(connectionId);
    });
});

async function handleStartConversation(ws, connectionId) {
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-preview-native-audio-dialog",
            systemInstruction: SYSTEM_INSTRUCTIONS,
            generationConfig: {
                temperature: 0.8, // Increased for more creative and varied responses
                maxOutputTokens: 300, // Increased for longer, more conversational responses
                topP: 0.9,
                topK: 40
            }
        });

        const connection = activeConnections.get(connectionId);
        connection.model = model;
        connection.chat = model.startChat();
        connection.isListening = true;
        connection.isSpeaking = false; // Track if AI is currently speaking

        ws.send(JSON.stringify({
            type: 'conversation_started',
            message: 'Ready to chat about Revolt Motors!'
        }));

        // Send initial greeting - multilingual and friendly
        connection.isSpeaking = true;
        const greetings = [
            "Hello! I'm Rev, your friendly Revolt Motors assistant. I can chat in Hindi, English, Tamil, Telugu, and other Indian languages! How can I help you today? Feel free to ask about our bikes, or we can just have a fun conversation!",
            "Namaste! Main Rev hun, Revolt Motors ka voice assistant. Hindi, English ya koi bhi language mein baat kar sakte hain. Kya madad chahiye? Bikes ke baare mein puchiye ya phir mazedaar baat-cheet karte hain!",
            "Vanakkam! Naan Rev, Revolt Motors assistant. Tamil, English, Hindi - edhu language la venumanalum pesalam! Electric bike pathi kekanum na illaati vera edhavathu fun-ah pesalam!"
        ];
        
        const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
        const greeting = await connection.chat.sendMessage(randomGreeting);
        
        ws.send(JSON.stringify({
            type: 'ai_response',
            text: greeting.response.text(),
            audio: null // Gemini Live API would provide audio here
        }));

        // Mark greeting as finished after estimated speaking time
        const greetingDuration = greeting.response.text().length * 50;
        setTimeout(() => {
            if (connection && connection.isSpeaking) {
                connection.isSpeaking = false;
                ws.send(JSON.stringify({
                    type: 'ai_finished_speaking'
                }));
            }
        }, greetingDuration);

    } catch (error) {
        console.error('Error starting conversation:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to start conversation'
        }));
    }
}

async function handleAudioData(ws, connectionId, audioData) {
    try {
        const connection = activeConnections.get(connectionId);
        
        if (!connection || !connection.chat) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'No active conversation'
            }));
            return;
        }

        // If AI is currently speaking, interrupt it naturally
        if (connection.isSpeaking) {
            connection.isSpeaking = false;
            ws.send(JSON.stringify({
                type: 'natural_interrupt',
                message: 'AI stopped due to user voice input'
            }));
        }

        // In a real implementation with Gemini Live API:
        // The API handles natural interruption automatically when it detects
        // new audio input while generating a response
        
        // Process the audio input
        // Convert audio data to the format expected by Gemini Live API
        const startTime = Date.now();
        
        // For demo purposes, we'll simulate speech-to-text
        // In production, this would be handled by Gemini Live API directly
        const transcribedText = await simulateSTT(audioData);
        
        // Send to Gemini Live API (simulated)
        const response = await connection.chat.sendMessage(transcribedText);
        const responseTime = Date.now() - startTime;
        
        console.log(`Response generated in ${responseTime}ms for: "${transcribedText}"`);

        // Mark AI as speaking
        connection.isSpeaking = true;

        ws.send(JSON.stringify({
            type: 'ai_response',
            text: response.response.text(),
            audio: null, // Would contain audio data from Gemini Live API
            latency: responseTime,
            transcription: transcribedText
        }));

        // Simulate AI finishing speaking after response duration
        const estimatedSpeakingTime = response.response.text().length * 50; // ~50ms per character
        setTimeout(() => {
            if (connection && connection.isSpeaking) {
                connection.isSpeaking = false;
                ws.send(JSON.stringify({
                    type: 'ai_finished_speaking'
                }));
            }
        }, estimatedSpeakingTime);

    } catch (error) {
        console.error('Error processing audio:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process audio'
        }));
    }
}

// Simulate speech-to-text for demo purposes
async function simulateSTT(audioData) {
    // In a real implementation, this would be handled by Gemini Live API
    // For demo, we'll return some sample queries
    const sampleQueries = [
        "Tell me about RV400 features",
        "What's the price of RV400 BRZ?",
        "How far can I travel on a single charge?",
        "What's the top speed?",
        "How do I book a test ride?",
        "Tell me about the mobile app features",
        "What colors are available?",
        "How long does charging take?",
        "What's included in the warranty?",
        "Where can I service my Revolt bike?"
    ];
    
    return sampleQueries[Math.floor(Math.random() * sampleQueries.length)];
}

async function handleInterrupt(ws, connectionId) {
    try {
        const connection = activeConnections.get(connectionId);
        
        if (connection) {
            // Stop current AI response
            connection.isListening = false;
            
            ws.send(JSON.stringify({
                type: 'interrupted',
                message: 'AI stopped speaking, ready for new input'
            }));
            
            // Reset listening state
            setTimeout(() => {
                if (activeConnections.has(connectionId)) {
                    activeConnections.get(connectionId).isListening = true;
                    ws.send(JSON.stringify({
                        type: 'ready_for_input',
                        message: 'Ready for your question'
                    }));
                }
            }, 500);
        }
    } catch (error) {
        console.error('Error handling interrupt:', error);
    }
}

async function handleEndConversation(ws, connectionId) {
    try {
        const connection = activeConnections.get(connectionId);
        
        if (connection) {
            connection.isListening = false;
            connection.chat = null;
            connection.model = null;
        }

        ws.send(JSON.stringify({
            type: 'conversation_ended',
            message: 'Conversation ended. Thanks for choosing Revolt Motors!'
        }));

    } catch (error) {
        console.error('Error ending conversation:', error);
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;