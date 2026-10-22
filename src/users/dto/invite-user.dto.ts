import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BranchRole, GlobalRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class BranchAssignmentDto {
  @ApiProperty({ example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ enum: BranchRole, example: BranchRole.CASHIER })
  @IsEnum(BranchRole)
  role!: BranchRole;
}

export class InviteUserDto {
  @ApiProperty({ example: 'cashier@store.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiPropertyOptional({ enum: GlobalRole, example: GlobalRole.ADMIN })
  @IsOptional()
  @IsEnum(GlobalRole)
  globalRole?: GlobalRole;

  @ApiPropertyOptional({ type: [BranchAssignmentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BranchAssignmentDto)
  branches?: BranchAssignmentDto[];
}
