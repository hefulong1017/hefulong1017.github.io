

% 设置 ii = 4 的参数
ii = 1;
m = 10*2^(ii-1);
n = 100*4^(ii-1);
x1 = 0; x2 = 1; t1 = 0; t2 = 1;
h = (x2-x1)/m; dt =(t2-t1)/n;

r = dt /(h^2);
rowA = [5/6+r, 1/12-r/2, zeros(1,m-3)];
A = toeplitz(rowA, [5/6+r, 1/12-r/2, zeros(1,m-3)]');
rowB = [5/6-r, 1/12+r/2, zeros(1,m-3)];
B = toeplitz(rowB, [5/6-r, 1/12+r/2, zeros(1,m-3)]');

disp('Matrix A:');
disp(A);
disp('Matrix B:');
disp(B);

% Householder QR 分解
[Q_h, R_h] = qr(B);  % Householder QR 分解
disp('Householder QR Decomposition:');
disp('Q:');
disp(Q_h);
disp('R:');
disp(R_h);

% Givens 旋转
[Q_g, R_g] = givens_rotation(B);  % Givens 旋转
disp('Givens Rotation:');
disp('Q:');
disp(Q_g);
disp('R:');
disp(R_g);