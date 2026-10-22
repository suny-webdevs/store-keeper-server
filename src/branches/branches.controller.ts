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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Audited } from '../common/decorators/audited.decorator.js';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator.js';
import { BranchesService } from './branches.service.js';
import { CreateBranchDto } from './dto/create-branch.dto.js';
import { UpdateBranchDto } from './dto/update-branch.dto.js';

@ApiTags('Branches')
@ApiBearerAuth('bearer')
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List accessible branches for the current user' })
  findAll(@Req() req: Request) {
    return this.branchesService.findAll(req.user!);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireGlobalRole('OWNER', 'ADMIN')
  @Audited({ action: 'branch.create', entityType: 'Branch' })
  @ApiOperation({ summary: 'Create new branch (OWNER, ADMIN)' })
  create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get branch details by ID' })
  findOne(@Param('id') id: string) {
    return this.branchesService.findOne(id);
  }

  @Patch(':id')
  @RequireGlobalRole('OWNER', 'ADMIN')
  @Audited({ action: 'branch.update', entityType: 'Branch' })
  @ApiOperation({ summary: 'Update branch (OWNER, ADMIN)' })
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @RequireGlobalRole('OWNER')
  @Audited({ action: 'branch.delete', entityType: 'Branch' })
  @ApiOperation({ summary: 'Delete branch (OWNER only, blocked if stock exists)' })
  remove(@Param('id') id: string) {
    return this.branchesService.remove(id);
  }
}
