const { EventEmitter } = require('events');

const EVENTS = {
  TASK_CREATED: 'task:created',
  PHASE_START: 'phase:start',
  PHASE_END: 'phase:end',
  PHASE_RETRY: 'phase:retry',
  SUBSTEP: 'substep',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  ROUND_END: 'round:end',
  LOG: 'log'
};

const GLOBAL_KEY = '__opc_event_bus__';

class EventBus extends EventEmitter {
  constructor() {
    super();
    if (global[GLOBAL_KEY]) return global[GLOBAL_KEY];
    global[GLOBAL_KEY] = this;
  }
}

module.exports = { EventBus, EVENTS };
