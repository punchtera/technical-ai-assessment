import { Global, Module } from '@nestjs/common';
import { APP_ENV, loadDotEnv, parseEnv } from './env';

@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useFactory: () => {
        loadDotEnv();
        return parseEnv(process.env);
      },
    },
  ],
  exports: [APP_ENV],
})
export class ConfigModule {}
