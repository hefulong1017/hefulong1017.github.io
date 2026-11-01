xa = 0;
xb = 2;
ya = 0;
yb = 4;
total_error = zeros(3, 1);
maxerror = zeros(3, 1);

for ii = 1:3
    m1 = 2^(ii+3);
    m2 = m1;
    h1 = (xb - xa) / m1;
    h2 = (yb - ya) / m2;
    x = linspace(xa, xb, m1+1)';
    y = linspace(ya, yb, m2+1)';
    u = zeros(m1+1, m2+1);
    
    for i = 1:m1+1
        u(i, 1) = 0;
        u(i, m2+1) = 0;
    end
    for j = 1:m2+1
        u(1, j) = 0;
        u(m1+1, j) = 0;
    end
    
    row1 = zeros(m1-1, 1);
    row1(1) = 10;
    row1(2) = 1;
    A = toeplitz(row1);
    row2 = zeros(m1-1, 1);
    row2(1) = -2;
    row2(2) = 1;
    B = toeplitz(row2);
    I = speye(m2-1); 
    A1 = inv(kron(A, I));
    B1 = kron(B, I);
    A2 =inv( kron(I, A));
    B2 = kron(I, B);
    
    C = (12/h1^2) * A1 * B1 + (12/h2^2) * A2 * B2;
f=zeros(m1-1,m2-1);
for j = 1:m2-1
    for k = 1:m1-1
        f(k,j) = 2*pi^2*sin(pi*x(k+1))*sin(pi*y(j+1));
    end
    
end
H = reshape(f,(m1-1)*(m2-1),1);
 U1 = -C \ H;
  

    U2 = reshape(U1, m1-1, m2-1);
    u(2:m1, 2:m2) = U2;
    
F=zeros(m1+1,m2+1);
    for i=1:m1+1
        for j=1:m2+1
            F(i,j)= sin(pi*x(i))*sin(pi*y(j));
        end
    end
    

    maxerror(ii) = max(max(abs(u - F)));
    
    disp(['最大误差 (层 ', num2str(ii), '): ', num2str(maxerror(ii))]);
end


for i = 1:2
    ord1 = maxerror(i) / maxerror(i+1);
    disp(['最大误差收敛阶 (层 ', num2str(i), '): ', num2str(ord1)]);
end