import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const ADMIN_PASSWORD = '@Admin123';
const USER_PASSWORD = '@User123';

const ADMIN_EMAILS = ['admin1@gmail.com', 'admin2@gmail.com', 'admin3@gmail.com'];

// Regular users (password: @User123). `tiktokLinked` is varied so the admin
// Users page donut/filters have a realistic mix to display.
const USERS: { email: string; displayName: string; tiktokLinked: boolean }[] = [
  { email: 'john.doe@example.com', displayName: 'John Doe', tiktokLinked: true },
  { email: 'alice.morgan@tech.io', displayName: 'Alice Morgan', tiktokLinked: false },
  { email: 'sam.chen@gmail.com', displayName: 'Sam Chen', tiktokLinked: true },
  { email: 'priya.nair@startups.co', displayName: 'Priya Nair', tiktokLinked: true },
  { email: 'marcus.webb@socialmkt.net', displayName: 'Marcus Webb', tiktokLinked: false },
  { email: 'elena.sousa@domain.br', displayName: 'Elena Sousa', tiktokLinked: true },
  { email: 'tom.baker@creative.uk', displayName: 'Tom Baker', tiktokLinked: true },
  { email: 'yuki.tanaka@example.jp', displayName: 'Yuki Tanaka', tiktokLinked: false },
  { email: 'carlos.lima@mediabr.com', displayName: 'Carlos Lima', tiktokLinked: true },
  { email: 'fatima@digitalme.ae', displayName: 'Fatima Al-Rashid', tiktokLinked: true },
  { email: 'ryan.ng@vncreator.vn', displayName: 'Ryan Nguyen', tiktokLinked: true },
  { email: 'sofia.rossi@milano.it', displayName: 'Sofia Rossi', tiktokLinked: false },
];

async function seedUser(
  email: string,
  password: string,
  role: UserRole,
  displayName: string,
  tiktokLinked = false,
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role, displayName, tiktokLinked },
    create: {
      email,
      passwordHash,
      role,
      displayName,
      tiktokLinked,
      identities: {
        create: { provider: 'local', providerUserId: email },
      },
    },
  });
  console.log(`seeded ${role}: ${user.email} (${user.id})`);
}

async function main() {
  for (const email of ADMIN_EMAILS) {
    await seedUser(email, ADMIN_PASSWORD, 'admin', email.split('@')[0]);
  }

  for (const u of USERS) {
    await seedUser(u.email, USER_PASSWORD, 'user', u.displayName, u.tiktokLinked);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
