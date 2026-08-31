import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadEvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
