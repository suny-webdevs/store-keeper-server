import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audited } from '../common/decorators/audited.decorator.js';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { AssignBranchDto, UpdateBranchRoleDto } from './dto/assign-branch.dto.js';
import { InviteUserDto } from './dto/invite-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('Users')
@ApiBearerAuth('bearer')
@RequireGlobalRole('OWNER', 'ADMIN')
@Controller('v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List tenant users with pagination (OWNER, ADMIN)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.usersService.findAll(query);
  }

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'user.invite', entityType: 'User' })
  @ApiOperation({ summary: 'Invite new user to tenant (OWNER, ADMIN)' })
  invite(@Body() dto: InviteUserDto) {
    return this.usersService.invite(dto);
  }

  @Patch(':id')
  @Audited({ action: 'user.update', entityType: 'User' })
  @ApiOperation({ summary: 'Update user profile/roles (OWNER, ADMIN)' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Audited({ action: 'user.delete', entityType: 'User' })
  @ApiOperation({ summary: 'Deactivate / soft-delete user (OWNER, ADMIN)' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Post(':id/branches')
  @HttpCode(HttpStatus.CREATED)
  @Audited({ action: 'user.branch_assign', entityType: 'UserBranchAccess' })
  @ApiOperation({ summary: 'Assign branch access to user (OWNER, ADMIN)' })
  assignBranch(@Param('id') id: string, @Body() dto: AssignBranchDto) {
    return this.usersService.assignBranch(id, dto);
  }

  @Patch(':id/branches/:branchId')
  @Audited({ action: 'user.branch_update', entityType: 'UserBranchAccess' })
  @ApiOperation({ summary: 'Update branch role for user (OWNER, ADMIN)' })
  updateBranchRole(
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchRoleDto,
  ) {
    return this.usersService.updateBranchRole(id, branchId, dto);
  }

  @Delete(':id/branches/:branchId')
  @Audited({ action: 'user.branch_remove', entityType: 'UserBranchAccess' })
  @ApiOperation({ summary: 'Remove user access from branch (OWNER, ADMIN)' })
  removeBranch(@Param('id') id: string, @Param('branchId') branchId: string) {
    return this.usersService.removeBranch(id, branchId);
  }
}
