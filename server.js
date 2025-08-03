const WebSocket = require('ws');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Use the correct model name - these models support audio input
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash" // This model supports audio input and returns text
});

// Alternative models you can try:
// const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const server = require('http').createServer((req, res) => {
    if (req.url === '/') {
        const htmlPath = path.join(__dirname, 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

const wss = new WebSocket.Server({ server });

// Store active sessions
const sessions = new Map();

class VoiceSession {
    constructor(ws) {
        this.ws = ws;
        this.chat = null;
        this.isActive = false;
        this.history = [];
    }

    async startConversation() {
        try {
            // Initialize chat with system prompt for Revolt Motors
            const systemPrompt = `You are Rev, a friendly multilingual voice assistant for Revolt Motors, India's leading electric motorcycle company. 

Key Information about Revolt Motors:
- Founded in 2019 by Rahul Sharma
- Headquarters: Gurugram, India
- Main products: RV400 and RV400 BRZ electric motorcycles
- Key features: Swappable batteries, mobile app connectivity, AI-enabled features
- Range: Up to 150km on single charge
- Top speed: 85 km/h
- Charging: Both swappable batteries and charging stations
- Price range: ₹1.2-1.4 lakhs (ex-showroom)

Personality and Behavior:
- Respond naturally in the same language the user speaks (Hindi, English, Tamil, Telugu, Bengali, Marathi, Gujarati, etc.)
- Be enthusiastic about electric vehicles and sustainable transportation
- Can discuss Revolt bikes, but also engage in general conversation, jokes, songs, and entertainment
- Keep responses conversational and friendly (2-3 sentences typically)
- If asked about other bike brands, be respectful but highlight Revolt's advantages
- Can share jokes, talk about Indian culture, technology, or any general topics

Language Guidelines:
- Automatically detect and respond in the user's preferred language
- Use natural, colloquial expressions appropriate to each language
- For Hindi: Use Hinglish when appropriate, common Hindi phrases
- For regional languages: Use local expressions and cultural references when relevant

Remember: You're having a natural voice conversation, so keep responses concise and engaging!`;

            this.chat = model.startChat({
                history: [
                    {
                        role: "user",
                        parts: [{ text: systemPrompt }]
                    },
                    {
                        role: "model", 
                        parts: [{ text: "Hello! I'm Rev, your Revolt Motors voice assistant! I'm ready to chat with you in Hindi, English, or any Indian language you prefer. I can help you learn about our amazing electric motorcycles, share some jokes, or just have a friendly conversation. What would you like to talk about?" }]
                    }
                ]
            });

            this.isActive = true;
            this.ws.send(JSON.stringify({
                type: 'conversation_started',
                message: 'Ready to chat! I can speak in multiple Indian languages.'
            }));

        } catch (error) {
            console.error('Error starting conversation:', error);
            this.ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to start conversation: ' + error.message
            }));
        }
    }

    async processAudio(audioData, mimeType) {
        if (!this.isActive || !this.chat) {
            throw new Error('Conversation not active');
        }

        try {
            console.log('Processing audio input...');
            const startTime = Date.now();

            // Convert base64 audio to proper format for Gemini
            const audioBuffer = Buffer.from(audioData, 'base64');

            // Send audio to Gemini for processing
            const result = await this.chat.sendMessage([
                {
                    inlineData: {
                        data: audioData,
                        mimeType: mimeType
                    }
                },
                { text: "Please respond to the audio message naturally in the same language the user spoke. Keep it conversational and friendly." }
            ]);

            const response = await result.response;
            const responseText = response.text();
            const latency = Date.now() - startTime;

            console.log('AI Response:', responseText);

            // Store in history for context
            this.history.push({
                type: 'audio_input',
                timestamp: new Date(),
                response: responseText
            });

            return {
                text: responseText,
                latency: latency
            };

        } catch (error) {
            console.error('Error processing audio:', error);
            throw error;
        }
    }

    endConversation() {
        this.isActive = false;
        this.chat = null;
        console.log('Conversation ended');
    }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('Client connected');
    
    const session = new VoiceSession(ws);
    sessions.set(ws, session);

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'start_conversation':
                    await handleStartConversation(ws, session);
                    break;
                    
                case 'audio_data':
                    await handleAudioData(ws, session, data);
                    break;
                    
                case 'natural_interrupt':
                    handleNaturalInterrupt(ws, session);
                    break;
                    
                case 'end_conversation':
                    handleEndConversation(ws, session);
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Server error: ' + error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (sessions.has(ws)) {
            sessions.get(ws).endConversation();
            sessions.delete(ws);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Handler functions
async function handleStartConversation(ws, session) {
    try {
        await session.startConversation();
    } catch (error) {
        console.error('Error starting conversation:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to start conversation'
        }));
    }
}

async function handleAudioData(ws, session, data) {
    try {
        const result = await session.processAudio(data.audio, data.mimeType);
        
        ws.send(JSON.stringify({
            type: 'ai_response',
            text: result.text,
            latency: result.latency,
            // Note: transcription would require additional speech-to-text service
            // transcription: "User's spoken text would go here"
        }));
        
    } catch (error) {
        console.error('Error processing audio:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to process audio: ' + error.message
        }));
    }
}

function handleNaturalInterrupt(ws, session) {
    // Handle interruption logic
    console.log('Natural interrupt received');
    ws.send(JSON.stringify({
        type: 'natural_interrupt_confirmed',
        message: 'AI stopped, ready for new input'
    }));
}

function handleEndConversation(ws, session) {
    session.endConversation();
    ws.send(JSON.stringify({
        type: 'conversation_ended',
        message: 'Conversation ended successfully'
    }));
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Revolt Motors Voice Assistant server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});