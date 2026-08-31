import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GuardsModule } from './guards.module';

@Module({
  imports: [GuardsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
