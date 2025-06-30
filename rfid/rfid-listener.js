const EventEmitter = require('events');

class RFIDListener extends EventEmitter {
    constructor(callback = null) {
        super();

        this.callback = callback;
        this.device = null;
        this.isListening = false;
        this.buffer = '';
        this.lastScanTime = 0;
        this.minScanInterval = parseFloat(process.env.RFID_MIN_SCAN_INTERVAL) || 1000; // ms
        this.inputTimeout = parseFloat(process.env.RFID_INPUT_TIMEOUT) || 500; // ms
        this.maxBufferLength = parseInt(process.env.RFID_MAX_BUFFER_LENGTH) || 15;
        this.lastInputTime = 0;
        this.HID = null;

        console.log('RFID Listener für Wareneinlagerung initialized:', {
            minScanInterval: this.minScanInterval,
            inputTimeout: this.inputTimeout,
            maxBufferLength: this.maxBufferLength
        });
    }

    async start() {
        if (this.isListening) {
            console.log('RFID Listener is already running');
            return true;
        }

        try {
            console.log('Starting RFID Listener für Wareneinlagerung...');

            // Try to load HID module with better error handling
            try {
                this.HID = require('node-hid');
            } catch (hidError) {
                console.error('Failed to load node-hid module:', hidError.message);
                console.log('💡 To fix this issue:');
                console.log('   1. Run: npm run rebuild');
                console.log('   2. Or: npm install --save-dev electron-rebuild && npx electron-rebuild');
                console.log('   3. If still failing, check if Python and build tools are installed');
                throw new Error('node-hid module not available. Run "npm run rebuild" to fix native bindings.');
            }

            // Find RFID device
            const device = await this.findRFIDDevice();

            if (!device) {
                throw new Error('No RFID device found. Please ensure your RFID reader is connected and configured as HID keyboard.');
            }

            // Open device
            this.device = new this.HID.HID(device.path);
            console.log(`RFID device opened: ${device.product} (${device.manufacturer})`);

            // Set up data handler
            this.device.on('data', (data) => {
                this.handleRawData(data);
            });

            // Handle device errors
            this.device.on('error', (error) => {
                console.error('RFID device error:', error);
                this.emit('error', error);
                this.stop();
            });

            this.isListening = true;
            this.emit('started');

            console.log('✅ RFID Listener für Wareneinlagerung started successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to start RFID Listener:', error.message);
            this.emit('error', error);
            return false;
        }
    }

    async stop() {
        if (!this.isListening) {
            return;
        }

        console.log('Stopping RFID Listener...');

        try {
            if (this.device) {
                this.device.close();
                this.device = null;
            }

            this.isListening = false;
            this.buffer = '';
            this.emit('stopped');

            console.log('✅ RFID Listener stopped successfully');

        } catch (error) {
            console.error('❌ Error stopping RFID Listener:', error);
        }
    }

    async findRFIDDevice() {
        try {
            if (!this.HID) {
                console.error('HID module not loaded');
                return null;
            }

            // Get all HID devices
            const devices = this.HID.devices();
            console.log(`Found ${devices.length} HID devices`);

            // Debug: log all devices for troubleshooting
            if (process.env.DEBUG === 'true') {
                console.log('All HID devices:');
                devices.forEach((device, index) => {
                    console.log(`  ${index + 1}. ${device.product || 'Unknown'} (${device.manufacturer || 'Unknown'})`);
                    console.log(`     VID: 0x${device.vendorId?.toString(16)}, PID: 0x${device.productId?.toString(16)}`);
                    console.log(`     Usage: ${device.usagePage}/${device.usage}`);
                });
            }

            // Filter for potential RFID devices
            const rfidDevices = devices.filter(device => {
                // Common RFID reader characteristics:
                // - Usually have 'keyboard' or 'HID' in product name
                // - Usage page 1 (Generic Desktop) and usage 6 (Keyboard)
                // - Some specific vendor/product IDs for known RFID readers

                const product = (device.product || '').toLowerCase();
                const manufacturer = (device.manufacturer || '').toLowerCase();

                // Common RFID reader indicators
                const isKeyboard = device.usagePage === 1 && device.usage === 6;
                const hasRFIDKeywords = product.includes('rfid') ||
                    product.includes('proximity') ||
                    product.includes('card') ||
                    product.includes('reader') ||
                    manufacturer.includes('rfid') ||
                    manufacturer.includes('mifare');

                // Known RFID reader vendor IDs (add more as needed)
                const knownRFIDVendors = [
                    0x08ff, // AuthenTec
                    0x072f, // Advanced Card Systems
                    0x0b81, // id3 Technologies
                    0x1d6b, // Linux Foundation (generic)
                    0x04e6, // SCM Microsystems
                    0x0483, // STMicroelectronics
                    0x046a, // Cherry GmbH (some RFID keyboards)
                    0x0c2e, // Honeywell (some RFID readers)
                ];

                const isKnownVendor = knownRFIDVendors.includes(device.vendorId);

                // Score based system
                let score = 0;
                if (isKeyboard) score += 3;
                if (hasRFIDKeywords) score += 5;
                if (isKnownVendor) score += 2;
                if (product.includes('keyboard') && !product.includes('rfid')) score -= 2;

                // Debug logging
                if (score > 0) {
                    console.log(`Potential RFID device (score: ${score}):`, {
                        product: device.product,
                        manufacturer: device.manufacturer,
                        vendorId: device.vendorId?.toString(16),
                        productId: device.productId?.toString(16),
                        usagePage: device.usagePage,
                        usage: device.usage,
                        path: device.path
                    });
                }

                return score >= 3; // Minimum score threshold
            });

            if (rfidDevices.length === 0) {
                console.log('No RFID devices detected. Falling back to first available keyboard device...');

                // Fallback: try first keyboard device
                const keyboards = devices.filter(device =>
                    device.usagePage === 1 && device.usage === 6
                );

                if (keyboards.length > 0) {
                    console.log('Using first keyboard device as RFID reader:', keyboards[0]);
                    return keyboards[0];
                }

                console.log('💡 RFID Device Detection Tips:');
                console.log('   1. Ensure RFID reader is connected via USB');
                console.log('   2. Check if reader appears as HID keyboard device');
                console.log('   3. Try different USB ports');
                console.log('   4. Verify reader drivers are installed');
                console.log('   5. Test reader with other applications first');

                return null;
            }

            // Sort by score and use best match
            rfidDevices.sort((a, b) => {
                const scoreA = this.calculateDeviceScore(a);
                const scoreB = this.calculateDeviceScore(b);
                return scoreB - scoreA;
            });

            const selectedDevice = rfidDevices[0];
            console.log('Selected RFID device:', {
                product: selectedDevice.product,
                manufacturer: selectedDevice.manufacturer,
                path: selectedDevice.path
            });

            return selectedDevice;

        } catch (error) {
            console.error('Error finding RFID device:', error);
            return null;
        }
    }

    calculateDeviceScore(device) {
        const product = (device.product || '').toLowerCase();
        const manufacturer = (device.manufacturer || '').toLowerCase();

        let score = 0;

        // Keyboard device
        if (device.usagePage === 1 && device.usage === 6) score += 3;

        // RFID keywords in product name
        if (product.includes('rfid')) score += 8;
        if (product.includes('proximity')) score += 6;
        if (product.includes('card')) score += 5;
        if (product.includes('reader')) score += 5;
        if (product.includes('scanner')) score += 4;

        // RFID keywords in manufacturer
        if (manufacturer.includes('rfid')) score += 6;
        if (manufacturer.includes('gis')) score += 7; // GiS mbH makes RFID readers

        // Known RFID device models
        if (product.includes('ts-hrw')) score += 10; // TS-HRW series are RFID readers
        if (product.includes('hrw')) score += 8;
        if (product.includes('mifare')) score += 6;
        if (product.includes('125khz')) score += 6;
        if (product.includes('13.56mhz')) score += 6;

        // Penalty for common non-RFID devices
        if (product.includes('keyboard') && !product.includes('rfid')) score -= 3;
        if (product.includes('mouse')) score -= 5;
        if (manufacturer.includes('logitech') && !product.includes('rfid')) score -= 4;
        if (manufacturer.includes('microsoft') && !product.includes('rfid')) score -= 4;
        if (product.includes('receiver') && !product.includes('rfid')) score -= 3;

        return score;
    }

    handleRawData(data) {
        try {
            const now = Date.now();

            // Convert HID data to characters
            const chars = this.hidDataToChars(data);

            if (!chars || chars.length === 0) {
                return;
            }

            // Check for input timeout (reset buffer if too much time passed)
            if (this.buffer && (now - this.lastInputTime) > this.inputTimeout) {
                console.log(`Input timeout, resetting buffer: "${this.buffer}"`);
                this.buffer = '';
            }

            this.lastInputTime = now;

            // Process each character
            for (const char of chars) {
                if (char === '\n' || char === '\r') {
                    // Enter key - end of tag
                    this.processBuffer();
                } else if (char >= '0' && char <= '9' ||
                    (char >= 'A' && char <= 'F') ||
                    (char >= 'a' && char <= 'f')) {
                    // Valid hex character
                    this.buffer += char.toUpperCase();

                    // Prevent buffer overflow
                    if (this.buffer.length > this.maxBufferLength) {
                        this.buffer = this.buffer.slice(-this.maxBufferLength);
                    }
                } else {
                    // Invalid character - might indicate end of tag or noise
                    if (this.buffer.length >= 8) {
                        // Process buffer if we have enough characters
                        this.processBuffer();
                    } else {
                        // Reset buffer for short invalid sequences
                        console.log(`Invalid character '${char}', resetting buffer: "${this.buffer}"`);
                        this.buffer = '';
                    }
                }
            }

        } catch (error) {
            console.error('Error handling raw data:', error);
        }
    }

    hidDataToChars(data) {
        // Convert HID keyboard data to characters
        // This is a simplified mapping - might need adjustment for specific devices

        const chars = [];

        for (let i = 0; i < data.length; i += 8) {
            // Standard HID keyboard report is 8 bytes
            // Byte 2 is the key code
            const keyCode = data[i + 2];

            if (keyCode === 0) continue; // No key pressed

            // Map HID key codes to characters
            const char = this.hidKeyCodeToChar(keyCode);
            if (char) {
                chars.push(char);
            }
        }

        return chars;
    }

    hidKeyCodeToChar(keyCode) {
        // HID keyboard key code mapping
        const keyMap = {
            // Numbers
            0x1E: '1', 0x1F: '2', 0x20: '3', 0x21: '4', 0x22: '5',
            0x23: '6', 0x24: '7', 0x25: '8', 0x26: '9', 0x27: '0',

            // Letters
            0x04: 'A', 0x05: 'B', 0x06: 'C', 0x07: 'D', 0x08: 'E', 0x09: 'F',
            0x0A: 'G', 0x0B: 'H', 0x0C: 'I', 0x0D: 'J', 0x0E: 'K', 0x0F: 'L',
            0x10: 'M', 0x11: 'N', 0x12: 'O', 0x13: 'P', 0x14: 'Q', 0x15: 'R',
            0x16: 'S', 0x17: 'T', 0x18: 'U', 0x19: 'V', 0x1A: 'W', 0x1B: 'X',
            0x1C: 'Y', 0x1D: 'Z',

            // Special keys
            0x28: '\n', // Enter
            0x2C: ' ',  // Space
        };

        return keyMap[keyCode] || null;
    }

    processBuffer() {
        if (!this.buffer) {
            return;
        }

        const tagId = this.buffer.trim();
        const originalBuffer = this.buffer;
        this.buffer = '';

        // Validate tag
        if (!this.validateTagId(tagId)) {
            console.log(`Invalid tag format, ignoring: "${originalBuffer}"`);
            return;
        }

        // Check scan interval
        const now = Date.now();
        if (now - this.lastScanTime < this.minScanInterval) {
            console.log(`Scan too fast, ignoring: ${tagId}`);
            return;
        }

        this.lastScanTime = now;

        console.log(`✅ RFID Tag detected für Wareneinlagerung: ${tagId}`);

        // Emit tag event
        this.emit('tag', tagId);

        // Call callback if provided
        if (this.callback && typeof this.callback === 'function') {
            try {
                this.callback(tagId);
            } catch (error) {
                console.error('Error in RFID callback:', error);
            }
        }
    }

    validateTagId(tagId) {
        // Validate RFID tag format
        if (!tagId || typeof tagId !== 'string') {
            return false;
        }

        // Remove whitespace and convert to uppercase
        const cleanTag = tagId.trim().toUpperCase();

        // Check length (typical RFID tags are 8-12 hex characters)
        if (cleanTag.length < 8 || cleanTag.length > 12) {
            return false;
        }

        // Check if valid hex string
        if (!/^[0-9A-F]+$/.test(cleanTag)) {
            return false;
        }

        // Check if convertible to number and not zero
        try {
            const decimal = parseInt(cleanTag, 16);
            return decimal > 0;
        } catch (error) {
            return false;
        }
    }

    // Utility methods for external use
    getStatus() {
        return {
            listening: this.isListening,
            deviceConnected: !!this.device,
            buffer: this.buffer,
            lastScanTime: this.lastScanTime,
            hidModuleLoaded: !!this.HID,
            mode: 'wareneinlagerung', // Identifiziert den Modus
            config: {
                minScanInterval: this.minScanInterval,
                inputTimeout: this.inputTimeout,
                maxBufferLength: this.maxBufferLength
            }
        };
    }

    clearBuffer() {
        this.buffer = '';
        console.log('RFID buffer cleared');
    }

    setMinScanInterval(interval) {
        this.minScanInterval = Math.max(100, interval); // Minimum 100ms
        console.log(`RFID scan interval set to ${this.minScanInterval}ms`);
    }

    // Test method for debugging
    simulateTag(tagId) {
        if (!this.validateTagId(tagId)) {
            console.error(`Invalid tag ID for simulation: ${tagId}`);
            return false;
        }

        console.log(`🧪 Simulating RFID tag für Wareneinlagerung: ${tagId}`);

        this.emit('tag', tagId);

        if (this.callback) {
            this.callback(tagId);
        }

        return true;
    }

    // Device discovery utility
    static async listHIDDevices() {
        try {
            const HID = require('node-hid');
            const devices = HID.devices();

            console.log('All HID Devices:');
            devices.forEach((device, index) => {
                console.log(`${index + 1}. ${device.product || 'Unknown Product'}`);
                console.log(`   Manufacturer: ${device.manufacturer || 'Unknown'}`);
                console.log(`   VID: 0x${device.vendorId?.toString(16)}`);
                console.log(`   PID: 0x${device.productId?.toString(16)}`);
                console.log(`   Usage: ${device.usagePage}/${device.usage}`);
                console.log(`   Path: ${device.path}`);
                console.log('');
            });

            return devices;
        } catch (error) {
            console.error('Error listing HID devices:', error);
            return [];
        }
    }
}

module.exports = RFIDListener;