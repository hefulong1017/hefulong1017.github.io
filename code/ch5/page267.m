for ii=1:4
xa = 0; xb = 1;
ya = 0; yb = 1;
ta = 0; tb = 1;
m=10*2^(ii+1);
n=m;
h = (xb-xa)/m;
dt = (tb-ta)/n;
x = xa:h:xb;  x = x';
y = ya:h:yb;  y = y';
t = ta:dt:tb; t = t';
r = dt/h;
u = zeros(m+1,m+1,n+1);
for i = 1:m+1
    for j = 1:m+1
        u(i,j,1)   = exp(1/2*(x(i)+y(j)));
    end
end
ff5 = @(x,y,t) 1/2*exp(1/2*(x+y)-t);
ff51 = @(x,y) -exp(1/2*(x+y));
for j = 1:m+1
    for k = 1:n+1
        u(1,j,k)   = exp(1/2*y(j)-t(k));
        u(m+1,j,k) = exp(1/2*(1+y(j))-t(k));
    end
end
for i = 1:m+1
    for k = 1:n+1
        u(i,1,k)   = exp(1/2*x(i)-t(k));
        u(i,m+1,k) = exp(1/2*(1+x(i))-t(k));
    end
end
for k = 1:n
    if k == 1
        u1 = zeros(m+1,m+1);
        for j = 2:m
            H1 = zeros(m-1,1);
            H1(1:m-1) = u(2:m,j,1)+1/2*dt*ff51(x(2:m),y(j))+1/4*dt^2*ff5(x(2:m),y(j),t(1));
            u1(1,j)   = 1/2*( (u(1,j,1)-1/4*r^2*(u(1,j-1,1)-2*u(1,j,1)+u(1,j+1,1)))+(u(1,j,2)-1/4*r^2*(u(1,j-1,2)-2*u(1,j,2)+u(1,j+1,2))));
            u1(m+1,j) = 1/2*((u(m+1,j,1)-1/4*r^2*(u(m+1,j-1,1)-2*u(m+1,j,1)+u(m+1,j+1,1)))+(u(m+1,j,2)-1/4*r^2*(u(m+1,j-1,2)-2*u(m+1,j,2)+u(m+1,j+1,2))));
            H = zeros(m-1,1);
            H(1,1)   = 1/4*r^2*u1(1,j);
            H(m-1,1) = 1/4*r^2*u1(m+1,j);
            row=zeros(m-1,1);
            row(1,1)=1+1/2*r^2;row(2,1)=-1/4*r^2;
            A=toeplitz(row);
            u1(2:m,j) = chase(A,(H1+H));
        end
        u12 = zeros(m+1,m+1);
        for i = 2:m
            H2= zeros(m-1,1);
            H2(1:m-1) = u1(i,2:m);
            u12(i,1)   = 1/2*( u(i,1,1)  +u(i,1,2)  );
            u12(i,m+1) = 1/2*( u(i,m+1,1)+u(i,m+1,2));
            H3 = zeros(m-1,1);
            H3(1,1)   = 1/4*r^2*u12(i,1);
            H3(m-1,1) = 1/4*r^2*u12(i,m+1);
            row11=zeros(m-1,1);
            row11(1,1)=1+1/2*r^2;row11(2,1)=-1/4*r^2;
            A1=toeplitz(row11);
            u12(i,2:m) = chase(A1,(H2+H3));
        end
        for i = 2:m
            for j = 2:m
                u(i,j,2) = 2*u12(i,j)-u(i,j,1);
            end
        end
    else
        u2 = zeros(m+1,m+1);
        for j = 2:m
            H5 = zeros(m-1,1);
            H5(1:m-1) = u(2:m,j,k)+1/2*dt^2*ff5(x(2:m),y(j),t(k));
            u2(1,j)   = 1/2*( (u(1,j,k-1)-1/2*r^2*(u(1,j-1,k-1)-2*u(1,j,k-1)+u(1,j+1,k-1)))+(u(1,j,k+1)-1/2*r^2*(u(1,j-1,k+1)-2*u(1,j,k+1)+u(1,j+1,k+1)))   );
            u2(m+1,j) = 1/2*( (u(m+1,j,k-1)-1/2*r^2*(u(m+1,j-1,k-1)-2*u(m+1,j,k-1)+u(m+1,j+1,k-1)))+(u(m+1,j,k+1)-1/2*r^2*(u(m+1,j-1,k+1)-2*u(m+1,j,k+1)+u(m+1,j+1,k+1)))   );
            H6 = zeros(m-1,1);
            H6(1,1)   = 1/2*r^2*u2(1,j);
            H6(m-1,1) = 1/2*r^2*u2(m+1,j);
            row0=zeros(m-1,1);
            row0(1,1)=1+r^2;row0(2,1)=-1/2*r^2;
            B=toeplitz(row0);
            u2(2:m,j) =chase(B,(H5+H6));
        end
        uu = zeros(m+1,m+1);
        for i = 2:m
            HH = zeros(m-1,1);
            HH(1:m-1) = u2(i,2:m);
            uu(i,1)   = 1/2*(u(i,1,k-1)+u(i,1,k+1));
            uu(i,m+1) = 1/2*(u(i,m+1,k-1)+u(i,m+1,k+1));
            HH1 = zeros(m-1,1);
            HH1(1,1)   = 1/2*r^2*uu(i,1);
            HH1(m-1,1) = 1/2*r^2*uu(i,m+1);
             row1=zeros(m-1,1);
            row1(1,1)=1+r^2;row1(2,1)=-1/2*r^2;
            C=toeplitz(row1);
            uu(i,2:m) = chase(C,(HH+HH1));
        end
        for i = 2:m
            for j = 2:m
                u(i,j,k+1) = 2*uu(i,j)-u(i,j,k-1);
            end
        end
    end
end
F = zeros(m+1,m+1,n+1);
for i = 1:m+1
    for j = 1:m+1
        for k = 1:n+1
            F(i,j,k) = exp(1/2*(x(i)+y(j))-t(k));
        end
    end
end
error = abs(F-u);
MaxErr(ii)=max(max(max(error)));
disp(MaxErr(ii));
  figure(3)
    mesh(x(2:m),y(2:m),error(2:m,2:m,end))
    hold on
end
for i=1:3
ord=MaxErr(i)/MaxErr(i+1);
disp(['收敛阶为',num2str(ord)]);
end
    figure(1)
    mesh(x, y, F(:, :, end));
    figure(2)
    mesh(x, y, u(:, :, end))
  
