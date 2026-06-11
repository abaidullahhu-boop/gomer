import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JWT_STRATEGY } from '../common/constants';
import { AppConfig } from '../config/configuration';
import { SlackModule } from '../slack/slack.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: JWT_STRATEGY }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        secret: configService.get('jwt.secret', { infer: true }),
        signOptions: {
          expiresIn: configService.get('jwt.expiresIn', { infer: true }),
        },
      }),
    }),
    UsersModule,
    WorkspacesModule,
    SlackModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
