import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Movement Logger - dedicated logging for movement and look direction debugging
 */
class MovementLogger {
  private logFile: string;
  private writeStream: fs.WriteStream | null = null;

  constructor() {
    // Logs folder in the bot package
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logFile = path.join(logsDir, 'movement.log');

    // Clear log on startup
    fs.writeFileSync(this.logFile, '');
    this.writeStream = fs.createWriteStream(this.logFile, { flags: 'a' });
  }

  /**
   * Log a movement event
   */
  log(event: string, data?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    const line = `[${timestamp}] ${event}${dataStr}\n`;

    if (this.writeStream) {
      this.writeStream.write(line);
    }
  }

  /**
   * Log look direction change with comparison
   */
  logLook(
    sessionId: number,
    event: 'pathfinder' | 'smooth' | 'target',
    yaw: number,
    pitch: number,
    prevYaw?: number,
    prevPitch?: number
  ): void {
    const yawDeg = (yaw * 180 / Math.PI).toFixed(1);
    const pitchDeg = (pitch * 180 / Math.PI).toFixed(1);

    let deltaStr = '';
    if (prevYaw !== undefined && prevPitch !== undefined) {
      let yawDelta = (yaw - prevYaw) * 180 / Math.PI;
      // Normalize delta
      while (yawDelta > 180) yawDelta -= 360;
      while (yawDelta < -180) yawDelta += 360;
      const pitchDelta = (pitch - prevPitch) * 180 / Math.PI;
      deltaStr = ` | delta: yaw=${yawDelta.toFixed(1)}deg pitch=${pitchDelta.toFixed(1)}deg`;

      // Flag large jumps
      if (Math.abs(yawDelta) > 30) {
        deltaStr += ' [JUMP!]';
      }
    }

    this.log(`[${sessionId}] LOOK-${event.toUpperCase()}`, {
      yaw: `${yawDeg}deg`,
      pitch: `${pitchDeg}deg`,
      delta: deltaStr || undefined
    });
  }

  /**
   * Log look direction change from any source (not tied to a movement session)
   * Used to track ALL look changes for debugging
   */
  logLookChange(
    source: string,
    yaw: number,
    pitch: number,
    prevYaw?: number,
    prevPitch?: number
  ): void {
    const yawDeg = (yaw * 180 / Math.PI).toFixed(1);
    const pitchDeg = (pitch * 180 / Math.PI).toFixed(1);

    let deltaInfo = '';
    let flags = '';
    if (prevYaw !== undefined && prevPitch !== undefined) {
      let yawDelta = (yaw - prevYaw) * 180 / Math.PI;
      while (yawDelta > 180) yawDelta -= 360;
      while (yawDelta < -180) yawDelta += 360;
      const pitchDelta = (pitch - prevPitch) * 180 / Math.PI;

      deltaInfo = ` Δyaw=${yawDelta.toFixed(1)}° Δpitch=${pitchDelta.toFixed(1)}°`;

      // Flag significant changes
      if (Math.abs(yawDelta) > 30) flags += ' [YAW-JUMP]';
      if (Math.abs(pitchDelta) > 15) flags += ' [PITCH-JUMP]';
    }

    this.log(`LOOK [${source}] yaw=${yawDeg}° pitch=${pitchDeg}°${deltaInfo}${flags}`);
  }

  /**
   * Log position update
   */
  logPosition(sessionId: number, x: number, y: number, z: number, targetX?: number, targetZ?: number): void {
    const pos = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
    let distStr = '';
    if (targetX !== undefined && targetZ !== undefined) {
      const dist = Math.sqrt((targetX - x) ** 2 + (targetZ - z) ** 2);
      distStr = ` | dist=${dist.toFixed(1)}`;
    }
    this.log(`[${sessionId}] POSITION: ${pos}${distStr}`);
  }

  /**
   * Log session start
   */
  logSessionStart(sessionId: number, targetX: number, targetY: number, targetZ: number, label: string): void {
    this.log(`\n${'='.repeat(60)}`);
    this.log(`[${sessionId}] MOVEMENT SESSION START: ${label}`);
    this.log(`[${sessionId}] Target: ${targetX.toFixed(1)},${targetY.toFixed(1)},${targetZ.toFixed(1)}`);
  }

  /**
   * Log session end
   */
  logSessionEnd(sessionId: number, result: string, duration: number): void {
    this.log(`[${sessionId}] MOVEMENT SESSION END: ${result} (${(duration / 1000).toFixed(1)}s)`);
    this.log(`${'='.repeat(60)}\n`);
  }

  /**
   * Close the write stream
   */
  close(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }
}

// Singleton
export const movementLogger = new MovementLogger();
