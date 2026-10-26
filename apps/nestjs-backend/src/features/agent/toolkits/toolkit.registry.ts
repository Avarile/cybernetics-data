import { Injectable } from '@nestjs/common';
import type { IToolkit, IToolkitId } from './toolkit.types';

/** Every toolkit registers itself here once; `agent_setup.toolkits` decides which ones run. */
@Injectable()
export class ToolkitRegistry {
  private readonly toolkits = new Map<IToolkitId, IToolkit>();

  register(toolkit: IToolkit) {
    if (this.toolkits.has(toolkit.id)) {
      throw new Error(`Toolkit ${toolkit.id} is registered twice`);
    }
    const taken = new Set(this.list().flatMap((t) => t.tools.map((tool) => tool.name)));
    for (const tool of toolkit.tools) {
      if (taken.has(tool.name)) throw new Error(`Tool ${tool.name} is defined twice`);
      taken.add(tool.name);
    }
    this.toolkits.set(toolkit.id, toolkit);
  }

  get(id: IToolkitId) {
    return this.toolkits.get(id);
  }

  list() {
    return [...this.toolkits.values()];
  }
}
