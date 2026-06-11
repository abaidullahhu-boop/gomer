import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { User } from '../database/entities';
import { UsersService } from './users.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Returns the full profile of the currently authenticated user. */
  @Get('me')
  getMe(@CurrentUser('userId') userId: string): Promise<User> {
    return this.usersService.findByIdOrFail(userId);
  }
}
