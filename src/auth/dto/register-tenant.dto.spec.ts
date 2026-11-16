import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterTenantDto } from './register-tenant.dto.js';

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(RegisterTenantDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('RegisterTenantDto', () => {
  it('accepts a valid payload and normalises the slug', async () => {
    const { dto, errors } = await validatePayload({
      tenantName: '  Acme Retail  ',
      slug: '  ACME-Retail ',
      fullName: '  Jane Doe ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.tenantName).toBe('Acme Retail');
    expect(dto.slug).toBe('acme-retail');
    expect(dto.fullName).toBe('Jane Doe');
  });

  it('allows omitting the slug', async () => {
    const { dto, errors } = await validatePayload({
      tenantName: 'Acme Retail',
      fullName: 'Jane Doe',
    });

    expect(errors).toHaveLength(0);
    expect(dto.slug).toBeUndefined();
  });

  it('accepts unicode letters in names', async () => {
    const { errors } = await validatePayload({
      tenantName: '门店零售',
      slug: 'mendian',
      fullName: '李 明',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects markup characters in tenantName', async () => {
    const { errors } = await validatePayload({
      tenantName: 'Acme <script>',
      fullName: 'Jane Doe',
    });

    expect(errors.some((e) => e.property === 'tenantName')).toBe(true);
  });

  it('rejects an invalid slug', async () => {
    const { errors } = await validatePayload({
      tenantName: 'Acme Retail',
      slug: 'bad slug',
      fullName: 'Jane Doe',
    });

    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });

  it('rejects out-of-range lengths', async () => {
    const { errors } = await validatePayload({
      tenantName: 'A',
      slug: 'ab',
      fullName: 'J',
    });

    expect(errors.map((e) => e.property).sort()).toEqual([
      'fullName',
      'slug',
      'tenantName',
    ]);
  });

  it('rejects non-string values', async () => {
    const { errors } = await validatePayload({
      tenantName: 123,
      fullName: ['Jane Doe'],
    });

    expect(errors.some((e) => e.property === 'tenantName')).toBe(true);
    expect(errors.some((e) => e.property === 'fullName')).toBe(true);
  });
});
