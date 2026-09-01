import { IsIn } from 'class-validator';

export type ClassificationDecision = 'confirm' | 'override' | 'dismiss';

export class ReviewClassificationDto {
  @IsIn(['confirm', 'override', 'dismiss'])
  decision!: ClassificationDecision;
}
