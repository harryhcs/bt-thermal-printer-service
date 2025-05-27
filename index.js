import express from 'express';
import noble from '@abandonware/noble';
import iconv from 'iconv-lite';
import fs from 'fs/promises';
import path from 'path';
import cors from 'cors';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(express.json());

// Printer service and characteristic UUIDs
const PRINTER_SERVICE = '49535343fe7d4ae58fa99fafd205e455'; // Cat Printer service UUID
const PRINTER_CHARACTERISTIC = '49535343-8841-43f4-a8d4-ecbe34729bb3'; // Cat Printer characteristic UUID
// ESC/POS Commands
const ESC = 0x1B;
const GS = 0x1D;
const FS = 0x1C;
const DLE = 0x10;
const EOT = 0x04;
const ENQ = 0x05;
const STATUS_COMMAND = [DLE, EOT, 0x01]; // Request printer status
const PAPER_OUT = 0x08; // Paper out bit in status response

// Basic commands
const INIT = [ESC, 0x40]; // Initialize printer
const FEED = [ESC, 0x64, 0x05]; // Feed 5 lines
const CUT = [GS, 0x56, 0x00]; // Cut paper
const ALIGN_LEFT = [ESC, 0x61, 0x00]; // Left alignment
const ALIGN_CENTER = [ESC, 0x61, 0x01]; // Center alignment
const ALIGN_RIGHT = [ESC, 0x61, 0x02]; // Right alignment
const CHAR_CODE_TABLE = [ESC, 0x74, 0x00]; // Set character code table
const LINE_SPACING = [ESC, 0x33, 0x00]; // Set line spacing to 0
const FEED_LINE = [ESC, 0x64, 0x01]; // Feed one line

// Configuration
const PRINTER_NAME = 'YHK-7887';
const SCAN_TIMEOUT = 15000;
const CHUNK_SIZE = 20; // M58-LL recommended chunk size
const SAVED_PRINTER_FILE = 'saved_printer.json';

class PrinterService {
  constructor() {
    this.connectedDevice = null;
    this.writeCharacteristic = null;
    this.readCharacteristic = null;
    this.isConnected = false;
    this.printQueue = [];
    this.isProcessingQueue = false;
  }

  // Helper function to create command buffer
  createCommandBuffer(commands) {
    return Buffer.from(commands);
  }

  // Helper function to chunk a buffer
  chunkBuffer(buffer, chunkSize = CHUNK_SIZE) {
    let chunks = [];
    for (let i = 0; i < buffer.length; i += chunkSize) {
      chunks.push(buffer.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async saveSelectedPrinter(deviceId) {
    try {
      await fs.writeFile(SAVED_PRINTER_FILE, JSON.stringify({ deviceId }));
    } catch (error) {
      console.error('Error saving printer:', error);
    }
  }

  async getSavedPrinter() {
    try {
      const data = await fs.readFile(SAVED_PRINTER_FILE, 'utf8');
      return JSON.parse(data).deviceId;
    } catch (error) {
      return null;
    }
  }

  async initializeBluetooth() {
    if (process.platform === 'linux') {
      try {
        console.log('Initializing Bluetooth adapter...');
        // Reset the Bluetooth adapter
        await execAsync('sudo hciconfig hci0 reset');
        // Set to piscan mode (page scan and inquiry scan)
        await execAsync('sudo hciconfig hci0 piscan');
        // Make sure the adapter is up
        await execAsync('sudo hciconfig hci0 up');
        console.log('Bluetooth adapter initialized');
      } catch (error) {
        console.error('Error initializing Bluetooth:', error);
      }
    }
  }

  async scanForDevices() {
    return new Promise(async (resolve, reject) => {
      const devices = [];

      // Initialize Bluetooth adapter first
      await this.initializeBluetooth();

      // Reset noble state
      if (noble.state === 'poweredOn') {
        await noble.stopScanningAsync();
      }

      // Wait for noble to be powered on
      if (noble.state !== 'poweredOn') {
        console.log('Waiting for Bluetooth to be ready...');
        noble.once('stateChange', (state) => {
          if (state === 'poweredOn') {
            console.log('Bluetooth is ready, starting scan...');
            // On Ubuntu, we need to scan with allowDuplicates=true
            const allowDuplicates = process.platform === 'linux';
            console.log('Using allowDuplicates:', allowDuplicates);
            startScan(allowDuplicates);
          } else {
            console.log('Bluetooth state:', state);
            reject(new Error('Bluetooth is not ready'));
          }
        });
      } else {
        // On Ubuntu, we need to scan with allowDuplicates=true
        const allowDuplicates = process.platform === 'linux';
        console.log('Using allowDuplicates:', allowDuplicates);
        startScan(allowDuplicates);
      }

      function startScan(allowDuplicates) {
        // Remove any existing listeners
        noble.removeAllListeners('discover');
        noble.removeAllListeners('scanStart');
        noble.removeAllListeners('scanStop');
        noble.removeAllListeners('warning');

        const timeout = setTimeout(() => {
          console.log('Scan timeout reached');
          noble.stopScanning();
          console.log('Found devices:', devices);
          resolve(devices);
        }, 10000);

        noble.on('discover', (peripheral) => {
          console.log('Found device:', {
            name: peripheral.advertisement.localName || 'Unknown',
            id: peripheral.id,
            address: peripheral.address,
            rssi: peripheral.rssi,
            services: peripheral.advertisement.serviceUuids || []
          });
          devices.push({
            name: peripheral.advertisement.localName,
            id: peripheral.id,
            address: peripheral.address,
            rssi: peripheral.rssi,
            services: peripheral.advertisement.serviceUuids
          });
        });

        noble.on('scanStart', () => {
          console.log('Scan started');
        });

        noble.on('scanStop', () => {
          console.log('Scan stopped');
        });

        noble.on('warning', (message) => {
          console.warn('Noble warning:', message);
        });

        noble.startScanningAsync([], allowDuplicates).catch(err => {
          console.error('Error starting scan:', err);
          reject(err);
        });
      }
    });
  }

  async connectToDevice(deviceId) {
    try {
      console.log('Starting printer discovery...');
      await noble.startScanningAsync([], false);

      const peripheral = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          noble.stopScanning();
          reject(new Error('Printer not found within timeout period'));
        }, SCAN_TIMEOUT);

        noble.on('discover', async (p) => {
          if (p.id === deviceId) {
            clearTimeout(timeout);
            noble.stopScanning();
            resolve(p);
          }
        });
      });

      console.log('Connecting to printer...');
      await peripheral.connectAsync();
      this.connectedDevice = peripheral;

      const services = await peripheral.discoverServicesAsync([]);
      console.log('Available services:', services.map(s => s.uuid));
      
      // Try to find the service by UUID or by checking if it contains our service UUID
      const service = services.find(s => 
        s.uuid === PRINTER_SERVICE || 
        s.uuid.replace(/-/g, '') === PRINTER_SERVICE
      );
      
      if (!service) {
        console.error('Available services:', services.map(s => s.uuid));
        throw new Error('Printer service not found. Available services: ' + services.map(s => s.uuid).join(', '));
      }

      console.log('Found service:', service.uuid);
      const characteristics = await service.discoverCharacteristicsAsync([]);
      console.log('Available characteristics:', characteristics.map(c => ({
        uuid: c.uuid,
        properties: c.properties
      })));

      // Try to find the characteristic by UUID or by checking if it contains our characteristic UUID
      this.writeCharacteristic = characteristics.find(c => 
        c.uuid === PRINTER_CHARACTERISTIC || 
        c.uuid.replace(/-/g, '') === PRINTER_CHARACTERISTIC ||
        (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))
      );

      if (!this.writeCharacteristic) {
        console.error('Available characteristics:', characteristics.map(c => ({
          uuid: c.uuid,
          properties: c.properties
        })));
        throw new Error('Write characteristic not found');
      }

      console.log('Found write characteristic:', this.writeCharacteristic.uuid);

      // Look for read characteristic, but don't fail if not found
      this.readCharacteristic = characteristics.find(c => 
        c.properties.includes('read') || 
        c.properties.includes('notify')
      );

      if (this.readCharacteristic) {
        console.log('Found read characteristic:', this.readCharacteristic.uuid);
        // Enable notifications if available
        if (this.readCharacteristic.properties.includes('notify')) {
          await this.readCharacteristic.subscribeAsync();
        }
      } else {
        console.log('No read characteristic found - status checking will be limited');
      }

      // Initialize printer
      await this.writeToPrinter(INIT);
      await this.writeToPrinter(CHAR_CODE_TABLE);

      this.isConnected = true;
      await this.saveSelectedPrinter(deviceId);
      return true;
    } catch (error) {
      console.error('Connection error:', error);
      this.isConnected = false;
      return false;
    }
  }

  async writeToPrinter(data) {
    if (!this.writeCharacteristic) {
      throw new Error('Printer not connected');
    }

    const buffer = Buffer.isBuffer(data) ? data : this.createCommandBuffer(data);
    const chunks = this.chunkBuffer(buffer);

    console.log(`Writing ${chunks.length} chunks to printer`);
    for (const chunk of chunks) {
      try {
        await this.writeCharacteristic.writeAsync(chunk, false);
        await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay between chunks
      } catch (error) {
        console.error('Error writing to printer:', error);
        throw new Error('Printer is out of paper or not ready');
      }
    }
  }

  // Process the print queue
  async processPrintQueue() {
    if (this.isProcessingQueue) {
      console.log('Queue is already being processed');
      return;
    }
    
    if (this.printQueue.length === 0) {
      console.log('Queue is empty');
      return;
    }

    this.isProcessingQueue = true;
    console.log(`Starting to process queue. Jobs in queue: ${this.printQueue.length}`);

    try {
      while (this.printQueue.length > 0) {
        const { job, resolve, reject, timestamp } = this.printQueue[0];
        console.log(`Processing job from ${timestamp}. Remaining jobs: ${this.printQueue.length}`);
        
        try {
          const result = await job();
          if (!result) {
            throw new Error('Print job failed');
          }
          console.log('Job completed successfully');
          resolve(result);
        } catch (error) {
          console.error('Job failed:', error);
          reject(error);
          // Don't continue processing the queue if we hit a paper-out error
          if (error.message.includes('out of paper') || error.message.includes('not ready')) {
            console.log('Stopping queue processing due to printer error');
            break;
          }
        }
        
        this.printQueue.shift(); // Remove the completed job
        console.log(`Job removed from queue. Remaining jobs: ${this.printQueue.length}`);
        
        // Add a small delay between jobs
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      this.isProcessingQueue = false;
      console.log('Queue processing completed');
    }
  }

  // Add a print job to the queue
  async addToPrintQueue(printJob) {
    console.log('Adding new job to queue');
    return new Promise((resolve, reject) => {
      this.printQueue.push({
        job: printJob,
        resolve,
        reject,
        timestamp: new Date().toISOString()
      });
      console.log(`Job added to queue. Current queue length: ${this.printQueue.length}`);
      
      // Start processing the queue if it's not already being processed
      if (!this.isProcessingQueue) {
        this.processPrintQueue();
      }
    });
  }

  async checkPrinterStatus() {
    if (!this.writeCharacteristic) {
      throw new Error('Printer not connected');
    }

    try {
      // Send a test print command
      await this.writeToPrinter([0x1B, 0x40]); // Initialize
      await this.writeToPrinter([0x1B, 0x74, 0x00]); // Set character code table
      
      // Try to print a single character
      await this.writeToPrinter(Buffer.from(' ', 'utf8'));
      
      // Add a small delay to let the printer process
      await new Promise(resolve => setTimeout(resolve, 100));

      // If we get here without an error, assume printer is ready
      return true;
    } catch (error) {
      console.error('Printer status check failed:', error);
      // If we get any error during the test print, assume paper out
      throw new Error('Printer is out of paper or not ready');
    }
  }

  async printText(text) {
    if (!this.isConnected) {
      throw new Error('Printer not connected');
    }

    return this.addToPrintQueue(async () => {
      try {
        // Check printer status before starting
        await this.checkPrinterStatus();

        console.log(`Starting to print text: ${text}`);
        await this.writeToPrinter(INIT);
        await this.writeToPrinter(CHAR_CODE_TABLE);
        
        const textBuffer = Buffer.from(text + '\n', 'utf8');
        await this.writeToPrinter(textBuffer);
        
        // Add a feed and cut to make it more distinct
        await this.writeToPrinter(FEED);
        await this.writeToPrinter(CUT);
        
        console.log(`Finished printing text: ${text}`);
        return true;
      } catch (error) {
        console.error('Print error:', error);
        if (error.message.includes('out of paper')) {
          throw new Error('Cannot print: Printer is out of paper');
        }
        throw error; // Re-throw the error instead of returning false
      }
    });
  }

  async printReceipt({ title, items, total, schoolName, footer, saleDate }) {
    if (!this.isConnected) {
      throw new Error('Printer not connected');
    }

    return this.addToPrintQueue(async () => {
      try {
        // Check printer status before starting
        await this.checkPrinterStatus();

        console.log(`Starting to print receipt: ${title}`);

        // Initialize printer
        console.log('Sending initialization command...');
        await this.writeToPrinter(INIT);
        await new Promise(resolve => setTimeout(resolve, 200));

        // Set character code table
        console.log('Setting character code table...');
        await this.writeToPrinter(CHAR_CODE_TABLE);
        await new Promise(resolve => setTimeout(resolve, 100));

        // Print school name if provided
        if (schoolName) {
          await this.writeToPrinter(ALIGN_CENTER);
          await this.writeToPrinter(Buffer.from(schoolName + '\n', 'utf8'));
          await this.writeToPrinter(Buffer.from('----------------\n', 'utf8'));
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Print title
        await this.writeToPrinter(ALIGN_CENTER);
        await this.writeToPrinter(Buffer.from(title + '\n', 'utf8'));
        await this.writeToPrinter(Buffer.from('----------------\n', 'utf8'));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Print sale date if provided
        if (saleDate) {
          await this.writeToPrinter(ALIGN_CENTER);
          await this.writeToPrinter(Buffer.from(saleDate + '\n', 'utf8'));
          await this.writeToPrinter(Buffer.from('----------------\n', 'utf8'));
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Print items
        await this.writeToPrinter(ALIGN_LEFT);
        for (const item of items) {
          const line = `${item.name.padEnd(20)}${item.price.padStart(10)}\n`;
          await this.writeToPrinter(Buffer.from(line, 'utf8'));
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Print total
        await this.writeToPrinter(Buffer.from('----------------\n', 'utf8'));
        const totalLine = `Total: R${total.toFixed(2)}\n`;
        await this.writeToPrinter(Buffer.from(totalLine, 'utf8'));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Print footer if provided
        if (footer) {
          await this.writeToPrinter(Buffer.from('----------------\n', 'utf8'));
          await this.writeToPrinter(ALIGN_CENTER);
          await this.writeToPrinter(Buffer.from(footer + '\n', 'utf8'));
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Add extra line feeds
        await this.writeToPrinter([0x0A, 0x0D, 0x0A, 0x0D]);
        await new Promise(resolve => setTimeout(resolve, 100));

        // Cut paper
        await this.writeToPrinter(CUT);
        await new Promise(resolve => setTimeout(resolve, 200));

        console.log(`Finished printing receipt: ${title}`);
        return true;
      } catch (error) {
        console.error('Receipt print error:', error);
        if (error.message.includes('out of paper')) {
          throw new Error('Cannot print: Printer is out of paper');
        }
        throw error; // Re-throw the error instead of returning false
      }
    });
  }

  async disconnect() {
    if (this.connectedDevice) {
      await this.connectedDevice.disconnectAsync();
      this.connectedDevice = null;
      this.writeCharacteristic = null;
      this.readCharacteristic = null;
      this.isConnected = false;
    }
  }
}

const printerService = new PrinterService();

// API Routes
app.get('/devices', async (req, res) => {
  try {
    const devices = await printerService.scanForDevices();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/connect', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const success = await printerService.connectToDevice(deviceId);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/print/text', async (req, res) => {
  try {
    const { deviceId, text } = req.body;
    if (!deviceId || !text) {
      return res.status(400).json({ error: 'Device ID and text are required' });
    }

    // Connect if not already connected
    if (!printerService.isConnected) {
      await printerService.connectToDevice(deviceId);
    }

    const success = await printerService.printText(text);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/print/receipt', async (req, res) => {
  try {
    const { deviceId, title, items, total, schoolName, footer, saleDate } = req.body;
    if (!deviceId || !title || !items || !total) {
      return res.status(400).json({ error: 'Device ID, title, items, and total are required' });
    }

    // Connect if not already connected
    if (!printerService.isConnected) {
      const connected = await printerService.connectToDevice(deviceId);
      if (!connected) {
        return res.status(500).json({ error: 'Failed to connect to printer' });
      }
    }

    try {
      const success = await printerService.printReceipt({ 
        title, 
        items, 
        total,
        schoolName,
        footer,
        saleDate
      });
      res.json({ success });
    } catch (printError) {
      console.error('Print error:', printError);
      if (printError.message.includes('out of paper')) {
        return res.status(503).json({ error: 'Printer is out of paper' });
      }
      return res.status(500).json({ error: printError.message });
    }
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/disconnect', async (req, res) => {
  try {
    await printerService.disconnect();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on port ${PORT} and host ${HOST}`);
});