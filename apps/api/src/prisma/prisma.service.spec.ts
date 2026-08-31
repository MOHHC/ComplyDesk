import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('calls $connect on module init and $disconnect on module destroy', async () => {
    const service = new PrismaService();
    const connectSpy = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined);
    const disconnectSpy = jest
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
