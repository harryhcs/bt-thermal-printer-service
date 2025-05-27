import noble from '@abandonware/noble';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function initializeBluetooth() {
  if (process.platform === 'linux') {
    try {
      console.log('Initializing Bluetooth adapter...');
      
      // First try to reset the Bluetooth service
      try {
        console.log('Resetting Bluetooth service...');
        await execAsync('sudo systemctl restart bluetooth');
        // Wait for the service to restart
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log('Error restarting Bluetooth service:', error.message);
      }

      // Use bluetoothctl to power cycle and set discoverable
      try {
        console.log('Configuring Bluetooth adapter...');
        const commands = [
          'power off',
          'power on',
          'discoverable on',
          'pairable on',
          'agent on',
          'scan on'
        ];

        for (const cmd of commands) {
          console.log(`Running bluetoothctl command: ${cmd}`);
          await execAsync(`echo "${cmd}" | sudo bluetoothctl`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('Bluetooth adapter configured');
      } catch (error) {
        console.log('Error configuring adapter:', error.message);
      }

      // Verify the adapter is up using bluetoothctl
      try {
        const { stdout } = await execAsync('echo "show" | sudo bluetoothctl');
        if (!stdout.includes('Powered: yes')) {
          throw new Error('Adapter is not powered on after initialization');
        }
        console.log('Bluetooth adapter is up and running');
      } catch (error) {
        console.log('Error verifying adapter state:', error.message);
      }
    } catch (error) {
      console.error('Error initializing Bluetooth:', error);
    }
  }
}

async function scanForDevices() {
  return new Promise(async (resolve, reject) => {
    const devices = [];

    // Initialize Bluetooth adapter first
    await initializeBluetooth();

    // Wait for noble to be powered on
    if (noble.state !== 'poweredOn') {
      console.log('Waiting for Bluetooth to be ready...');
      noble.once('stateChange', (state) => {
        if (state === 'poweredOn') {
          console.log('Bluetooth is ready, starting scan...');
          startScan();
        } else {
          console.log('Bluetooth state:', state);
          reject(new Error('Bluetooth is not ready'));
        }
      });
    } else {
      console.log('Bluetooth is ready, starting scan...');
      startScan();
    }

    function startScan() {
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
      }, 30000); // Increased timeout to 30 seconds

      noble.on('discover', (peripheral) => {
        const deviceInfo = {
          name: peripheral.advertisement.localName || 'Unknown',
          id: peripheral.id,
          address: peripheral.address,
          rssi: peripheral.rssi,
          services: peripheral.advertisement.serviceUuids || [],
          manufacturerData: peripheral.advertisement.manufacturerData ? 
            peripheral.advertisement.manufacturerData.toString('hex') : null,
          txPowerLevel: peripheral.advertisement.txPowerLevel,
          connectable: peripheral.connectable
        };
        console.log('Found device:', deviceInfo);
        devices.push(deviceInfo);
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

      // Start scanning with all options enabled
      noble.startScanningAsync([], true, true).catch(err => {
        console.error('Error starting scan:', err);
        reject(err);
      });

      // Also start a bluetoothctl scan in parallel
      execAsync('echo "scan on" | sudo bluetoothctl').catch(err => {
        console.log('Error starting bluetoothctl scan:', err.message);
      });
    }
  });
}

// Run the scan
console.log('Starting Bluetooth scan test...');
console.log('Platform:', process.platform);
console.log('Noble state:', noble.state);

scanForDevices()
  .then(devices => {
    console.log('Scan completed. Found devices:', devices);
    process.exit(0);
  })
  .catch(error => {
    console.error('Scan failed:', error);
    process.exit(1);
  }); 