import { ApiProperty } from '@nestjs/swagger';
import { BranchRole } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class AssignBranchDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ enum: BranchRole, example: BranchRole.CASHIER })
  @IsEnum(BranchRole)
  role!: BranchRole;
}

export class UpdateBranchRoleDto {
  @ApiProperty({ enum: BranchRole, example: BranchRole.MANAGER })
  @IsEnum(BranchRole)
  role!: BranchRole;
}
