import fs from 'fs';
import path from 'path';

type HandlerConstructor<T> = new () => T;

export class HandlerFactory<T> {
    private handlerMap = new Map<string, HandlerConstructor<T>>();

    register(handlerDir: string): void {
        const entries = fs.readdirSync(handlerDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            
            const name = entry.name;
            const modulePath = path.join(handlerDir, name);
            
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(modulePath) as { default: HandlerConstructor<T> };
            if (!mod.default) continue;
            
            this.handlerMap.set(name, mod.default);
        }
    }

    create(name: string): T | undefined {
        const Ctor = this.handlerMap.get(name);
        if (!Ctor) return undefined;
        return new Ctor();
    }

    getConstructor(name: string): HandlerConstructor<T> | undefined {
        return this.handlerMap.get(name);
    }

    createAll(): Map<string, T> {
        const handlers = new Map<string, T>();
        this.handlerMap.forEach((Ctor, name) => {
            handlers.set(name, new Ctor());
        });
        return handlers;
    }
}