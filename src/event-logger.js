const fs = require('fs');
const path = require('path');
const { EventBus, EVENTS } = require('./event-bus');

class EventLogger {
  constructor(roundDir) {
    this.logPath = path.join(roundDir, 'events.jsonl');
    this.eventBus = new EventBus();
    this.subscribeAll();
  }

  subscribeAll() {
    const allEvents = Object.values(EVENTS);
    allEvents.forEach(eventName => {
      this.eventBus.on(eventName, (data) => {
        this.append({ ts: Date.now(), type: eventName, ...data });
      });
    });
  }

  append(entry) {
    const cleaned = this.sanitize(entry);
    fs.appendFileSync(this.logPath, JSON.stringify(cleaned) + '\n');
  }

  sanitize(obj) {
    if (obj instanceof Error) {
      return { message: obj.message, stack: obj.stack };
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item));
    }
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value instanceof Error) {
          result[key] = { message: value.message, stack: value.stack };
        } else if (typeof value === 'function' || Buffer.isBuffer(value)) {
          continue;
        } else if (value && typeof value === 'object') {
          result[key] = this.sanitize(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    return obj;
  }
}

module.exports = { EventLogger };
