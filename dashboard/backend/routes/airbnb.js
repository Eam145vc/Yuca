const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const COOKIES_PATH = path.join(__dirname, '../../../data/cookies.json');
const LOGIN_SCRIPT_PATH = path.join(__dirname, '../../../scripts/loginAndSaveCookies.js');

// Check Airbnb login status
router.get('/status', authMiddleware, async (req, res) => {
    try {
        // Check if cookies file exists
        try {
            const cookiesData = await fs.readFile(COOKIES_PATH, 'utf-8');
            const cookies = JSON.parse(cookiesData);
            
            // Check if cookies are not expired (simple check)
            const hasValidCookies = cookies && cookies.length > 0;
            const lastModified = await fs.stat(COOKIES_PATH);
            const hoursSinceLastLogin = (Date.now() - lastModified.mtime.getTime()) / (1000 * 60 * 60);
            
            res.json({
                loggedIn: hasValidCookies,
                lastLogin: lastModified.mtime,
                hoursAgo: Math.round(hoursSinceLastLogin),
                cookiesExpired: hoursSinceLastLogin > 24 // Consider expired after 24 hours
            });
        } catch (error) {
            res.json({
                loggedIn: false,
                error: 'No cookies found'
            });
        }
    } catch (error) {
        console.error('Error checking Airbnb status:', error);
        res.status(500).json({ error: 'Error checking login status' });
    }
});

// Trigger Airbnb login
router.post('/login', authMiddleware, async (req, res) => {
    try {
        // Check if login script exists
        try {
            await fs.access(LOGIN_SCRIPT_PATH);
        } catch (error) {
            return res.status(404).json({ 
                error: 'Login script not found',
                path: LOGIN_SCRIPT_PATH 
            });
        }
        
        // Check environment variables
        if (!process.env.AIRBNB_EMAIL || !process.env.AIRBNB_PASSWORD) {
            return res.status(400).json({ 
                error: 'AIRBNB_EMAIL and AIRBNB_PASSWORD must be set in .env file' 
            });
        }
        
        if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            return res.status(400).json({ 
                error: 'TELEGRAM_TOKEN and TELEGRAM_CHAT_ID must be set in .env file for 2FA' 
            });
        }
        
        // Start login process
        console.log('🚀 Starting Airbnb login process...');
        
        const loginProcess = spawn('node', [LOGIN_SCRIPT_PATH], {
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        loginProcess.stdout.on('data', (data) => {
            const message = data.toString();
            output += message;
            console.log('[Airbnb Login]', message.trim());
        });
        
        loginProcess.stderr.on('data', (data) => {
            const message = data.toString();
            errorOutput += message;
            console.error('[Airbnb Login Error]', message.trim());
        });
        
        loginProcess.on('close', async (code) => {
            if (code === 0) {
                // Success - check if cookies were saved
                try {
                    await fs.access(COOKIES_PATH);
                    res.json({
                        success: true,
                        message: 'Login successful! Cookies saved.',
                        output: output.split('\n').filter(line => line.trim())
                    });
                } catch (error) {
                    res.status(500).json({
                        success: false,
                        error: 'Login process completed but cookies were not saved',
                        output: output.split('\n').filter(line => line.trim())
                    });
                }
            } else {
                res.status(500).json({
                    success: false,
                    error: `Login process failed with code ${code}`,
                    output: output.split('\n').filter(line => line.trim()),
                    errorOutput: errorOutput.split('\n').filter(line => line.trim())
                });
            }
        });
        
        loginProcess.on('error', (error) => {
            console.error('Failed to start login process:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to start login process',
                details: error.message
            });
        });
        
        // Send immediate response that process started
        res.json({
            success: true,
            message: 'Login process started. Check Telegram for 2FA if required.',
            note: 'The login window will open in the server. Follow the progress in server logs.'
        });
        
    } catch (error) {
        console.error('Error initiating Airbnb login:', error);
        res.status(500).json({ error: 'Error starting login process' });
    }
});

// Clear cookies (logout)
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        await fs.unlink(COOKIES_PATH);
        res.json({
            success: true,
            message: 'Cookies cleared successfully'
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.json({
                success: true,
                message: 'No cookies to clear'
            });
        } else {
            console.error('Error clearing cookies:', error);
            res.status(500).json({ error: 'Error clearing cookies' });
        }
    }
});

module.exports = router;