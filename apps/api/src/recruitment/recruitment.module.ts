import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

@Module({ imports: [EmployeesModule], controllers: [RecruitmentController], providers: [RecruitmentService] })
export class RecruitmentModule {}
