import { ApiPropertyOptional } from '@nestjs/swagger';
import { GlobalRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ enum: GlobalRole, nullable: true })
  @IsOptional()
  @IsEnum(GlobalRole)
  globalRole?: GlobalRole | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
