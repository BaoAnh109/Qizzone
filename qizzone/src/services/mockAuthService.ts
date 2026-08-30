import type {
  User,
  LoginCredentials,
  RegisterData,
  AuthResponse,
} from "@/types/auth";

const USERS_STORAGE_KEY = "qizzone_users_db";

interface StoredUser extends User {
  passwordHash: string;
}

const DEFAULT_USERS: StoredUser[] = [
  {
    id: "user-tea-001",
    email: "teacher@qizzone.edu.vn",
    fullName: "Thầy Nguyễn Văn Anh",
    name: "Thầy Nguyễn Văn Anh",
    role: "teacher",
    avatarUrl: "",
    createdAt: "2026-08-01T08:00:00.000Z",
    passwordHash: "123456",
  },
  {
    id: "user-stu-001",
    email: "student@qizzone.edu.vn",
    fullName: "Trần Bảo Nam",
    name: "Trần Bảo Nam",
    role: "student",
    avatarUrl: "",
    createdAt: "2026-08-01T08:00:00.000Z",
    passwordHash: "123456",
  },
];

function getStoredUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(DEFAULT_USERS));
      return DEFAULT_USERS;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_USERS;
  }
}

function saveStoredUsers(users: StoredUser[]): void {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch (err) {
    console.error("Failed to save users into localStorage", err);
  }
}

// UTF-8 safe Base64 encoder for browser & Unicode strings
function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Generate simple mock JWT-like token safely with Unicode support
function generateMockToken(user: User): string {
  const header = toBase64Utf8(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Utf8(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.fullName,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
  );
  const signature = toBase64Utf8(`mock-signature-${Date.now()}`);
  return `${header}.${payload}.${signature}`;
}

export const mockAuthService = {
  /**
   * Mock login with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    await new Promise((resolve) => setTimeout(resolve, 400));

    const users = getStoredUsers();
    const cleanEmail = credentials.email.trim().toLowerCase();

    const found = users.find(
      (u) => u.email.toLowerCase() === cleanEmail
    );

    if (!found) {
      throw new Error("Tài khoản email này chưa được đăng ký trong hệ thống");
    }

    if (found.passwordHash !== credentials.password) {
      throw new Error("Mật khẩu không chính xác, vui lòng thử lại");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeUser } = found;
    const token = generateMockToken(safeUser);

    return {
      user: safeUser,
      token,
      message: "Đăng nhập thành công",
    };
  },

  /**
   * Mock register new user
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const users = getStoredUsers();
    const cleanEmail = data.email.trim().toLowerCase();

    if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("Địa chỉ email này đã được sử dụng bởi tài khoản khác");
    }

    const newUser: StoredUser = {
      id: `user-${data.role === "teacher" ? "tea" : "stu"}-${Date.now().toString(36)}`,
      email: cleanEmail,
      fullName: data.fullName.trim(),
      name: data.fullName.trim(),
      role: data.role,
      avatarUrl: "",
      createdAt: new Date().toISOString(),
      passwordHash: data.password,
    };

    users.push(newUser);
    saveStoredUsers(users);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeUser } = newUser;
    const token = generateMockToken(safeUser);

    return {
      user: safeUser,
      token,
      message: "Đăng ký tài khoản thành công",
    };
  },

  /**
   * Update profile
   */
  async updateProfile(userId: string, data: Partial<User>): Promise<User> {
    await new Promise((resolve) => setTimeout(resolve, 300));

    const users = getStoredUsers();
    const index = users.findIndex((u) => u.id === userId);

    if (index === -1) {
      throw new Error("Không tìm thấy thông tin người dùng");
    }

    const updated = {
      ...users[index],
      ...data,
      name: data.fullName || data.name || users[index].name,
    };

    users[index] = updated;
    saveStoredUsers(users);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeUser } = updated;
    return safeUser;
  },

  /**
   * Get user profile by ID
   */
  async getProfile(userId: string): Promise<User> {
    await new Promise((resolve) => setTimeout(resolve, 200));

    const users = getStoredUsers();
    const found = users.find((u) => u.id === userId);

    if (!found) {
      throw new Error("Không tìm thấy người dùng");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeUser } = found;
    return safeUser;
  },
};

export default mockAuthService;
