import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentsModule } from './agents/agents.module.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory =
  basename(moduleDirectory) === 'src'
    ? resolve(moduleDirectory, '../dist/public')
    : resolve(moduleDirectory, 'public');

@Module({
  imports: [
    // Em produção, dist/app.module.js fica ao lado de dist/public (build do cliente).
    ServeStaticModule.forRoot({
      rootPath: publicDirectory,
      exclude: ['/api/{*path}'],
    }),
    AgentsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
