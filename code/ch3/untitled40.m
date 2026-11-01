% 设置 ii = 1 的参数
ii = 1;
m = 10*2^(ii-1);  % 对应于 ii=1 时 m=10
n = 100*4^(ii-1); % 对应于 ii=1 时 n=100
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
h = (x2-x1)/m; dt =(t2-t1)/n;

r = dt /(h^2);
rowA = [5/6+r, 1/12-r/2, zeros(1,m-3)];
A = toeplitz(rowA, [5/6+r, 1/12-r/2, zeros(1,m-3)]');
rowB = [5/6-r, 1/12+r/2, zeros(1,m-3)];
B = toeplitz(rowB, [5/6-r, 1/12+r/2, zeros(1,m-3)]');

disp('Matrix A for ii=1:');
disp(A);
disp('Matrix B for ii=1:');
disp(B);

% 测试向量 b
b = ones(m-1, 1);

% LU 分解
disp('Performing LU Decomposition on Matrix A:');
[L_A, U_A] = lu_decomposition(A);
disp('Lower Triangular Matrix L for A:');
disp(L_A);
disp('Upper Triangular Matrix U for A:');
disp(U_A);

disp('Performing LU Decomposition on Matrix B:');
[L_B, U_B] = lu_decomposition(B);
disp('Lower Triangular Matrix L for B:');
disp(L_B);
disp('Upper Triangular Matrix U for B:');
disp(U_B);