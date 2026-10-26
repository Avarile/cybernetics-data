import { Injectable } from '@nestjs/common';

/**
 * Abort handles of the runs streaming from this process. A cancel that lands on another replica
 * is picked up through the run's status, which every step checks (see AgentRuntime).
 */
@Injectable()
export class RunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  open(runId: string) {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  abort(runId: string, reason = 'cancelled') {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort(new Error(reason));
    return true;
  }

  close(runId: string) {
    this.controllers.delete(runId);
  }

  isOpen(runId: string) {
    return this.controllers.has(runId);
  }
}
